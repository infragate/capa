import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../config';
import * as safeRemoteUrl from '../../safe-remote-url';
import { CapaDatabase } from '../../../db/database';
import { AuthenticatedFetch } from '../../authenticated-fetch';
import {
  installRegistry,
  stageRegistry,
  executeStagedRegistry,
  writeStagedAdapter,
  hashAdapterContent,
  assertAdapterHash,
  fetchAdapterSource,
  deriveSlug,
  isValidSlug,
  getInstalledAdapterPath,
  removeInstalledAdapter,
} from '../installer';

const VALID_ADAPTER = `export default {
  manifest: { id: 'unit', name: 'Unit', capabilities: ['skills'] },
  search: async () => ({ items: [] }),
  view: async () => ({
    id: 'x', capability: 'skills', title: 'X', preview: '',
    installSnippet: { id: 'x', type: 'inline', def: { content: '' } },
  }),
};`;

describe('installer — slug helpers', () => {
  it('isValidSlug accepts allowed characters', () => {
    expect(isValidSlug('skills-sh')).toBe(true);
    expect(isValidSlug('a1')).toBe(true);
    expect(isValidSlug('MyRegistry')).toBe(true);
  });

  it('isValidSlug rejects spaces, dots, slashes, and leading dashes', () => {
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('with.dot')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
    expect(isValidSlug('-leading-dash')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });

  it('deriveSlug uses the @ basename for github/gitlab search form', () => {
    expect(deriveSlug('infragate/capa@skills-sh', 'github')).toBe('skills-sh');
  });

  it('deriveSlug uses the last path segment for the :: exact form', () => {
    expect(deriveSlug('infragate/capa::registries/cursor-marketplace', 'gitlab')).toBe(
      'cursor-marketplace',
    );
  });

  it('deriveSlug strips the extension for URL form', () => {
    expect(deriveSlug('https://example.com/path/my-adapter.ts', 'url')).toBe('my-adapter');
  });
});

function evilAdapter(markerPath: string): string {
  return `import { writeFileSync } from 'fs';
writeFileSync(${JSON.stringify(markerPath)}, 'pwned');
${VALID_ADAPTER}`;
}

describe('installer — url policy', () => {
  let tempDir: string;
  let managedDir: string;
  let db: CapaDatabase;
  let managedDirSpy: ReturnType<typeof spyOn>;
  let authFetch: AuthenticatedFetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-installer-test-'));
    managedDir = join(tempDir, 'registries-managed');
    mkdirSync(join(tempDir, 'db'), { recursive: true });
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);
    db = new CapaDatabase(join(tempDir, 'db', 'test.db'));
    authFetch = new AuthenticatedFetch(db);
  });

  afterEach(() => {
    managedDirSpy.mockRestore();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('rejects localhost HTTP adapter URLs', async () => {
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'http://localhost:9/adapter.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/https|not allowed/i);
  });

  it('rejects loopback, private, and link-local HTTPS hosts', async () => {
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'https://127.0.0.1/adapter.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/not allowed/i);
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'https://10.1.2.3/adapter.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/not allowed/i);
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'https://169.254.169.254/adapter.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects plain HTTP even for public hosts', async () => {
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'http://example.com/adapter.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/https/i);
  });

  it('rejects URLs whose filename is not .ts/.js/.mjs without DNS', async () => {
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'https://example.com/adapter.txt' },
        authFetch,
      ),
    ).rejects.toThrow(/\.ts, \.js, or \.mjs extension/);
  });

  it('rejects invalid slugs before any network access', async () => {
    await expect(
      installRegistry(
        { slug: 'has space', type: 'url', source: 'https://example.com/a.ts' },
        authFetch,
      ),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('fetchAdapterSource also rejects localhost HTTP', async () => {
    await expect(
      fetchAdapterSource({ type: 'url', source: 'http://localhost:9/adapter.ts' }, authFetch),
    ).rejects.toThrow(/https|not allowed/i);
  });
});

describe('installer — pending vs execute', () => {
  let tempDir: string;
  let managedDir: string;
  let db: CapaDatabase;
  let managedDirSpy: ReturnType<typeof spyOn>;
  let authFetch: AuthenticatedFetch;
  let urlPolicySpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-stage-test-'));
    managedDir = join(tempDir, 'registries-managed');
    mkdirSync(join(tempDir, 'db'), { recursive: true });
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);
    db = new CapaDatabase(join(tempDir, 'db', 'test.db'));
    authFetch = new AuthenticatedFetch(db);
  });

  afterEach(() => {
    urlPolicySpy?.mockRestore();
    urlPolicySpy = undefined;
    managedDirSpy.mockRestore();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  function allowLocalUrlPolicy(): void {
    urlPolicySpy = spyOn(safeRemoteUrl, 'assertPublicHttpsUrl').mockImplementation(
      async (urlString: string) => new URL(urlString),
    );
  }

  it('writeStagedAdapter writes bytes and a hash without importing', () => {
    const marker = join(tempDir, 'pwned.txt');
    const staged = writeStagedAdapter('evil', evilAdapter(marker), '.ts');
    expect(existsSync(staged.adapterPath)).toBe(true);
    expect(staged.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(marker)).toBe(false);
    expect(hashAdapterContent(readFileSync(staged.adapterPath, 'utf-8'))).toBe(
      staged.contentSha256,
    );
  });

  it('stageRegistry fetches and writes without importing top-level adapter code', async () => {
    allowLocalUrlPolicy();
    const marker = join(tempDir, 'pwned.txt');
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(evilAdapter(marker), {
          headers: { 'content-type': 'application/typescript' },
        });
      },
    });
    try {
      const url = `http://127.0.0.1:${server.port}/adapter.ts`;
      const staged = await stageRegistry(
        { slug: 'evil', type: 'url', source: url },
        authFetch,
      );
      expect(existsSync(staged.adapterPath)).toBe(true);
      expect(staged.contentSha256).toHaveLength(64);
      expect(existsSync(marker)).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('executeStagedRegistry imports the staged adapter (top-level side effects may run)', async () => {
    const marker = join(tempDir, 'pwned.txt');
    const staged = writeStagedAdapter('evil', evilAdapter(marker), '.ts');
    expect(existsSync(marker)).toBe(false);
    const result = await executeStagedRegistry('evil', staged.contentSha256);
    expect(result.manifest.id).toBe('unit');
    expect(existsSync(marker)).toBe(true);
  });

  it('executeStagedRegistry refuses a hash mismatch without importing', async () => {
    const marker = join(tempDir, 'pwned.txt');
    writeStagedAdapter('evil', evilAdapter(marker), '.ts');
    await expect(
      executeStagedRegistry('evil', '0'.repeat(64)),
    ).rejects.toThrow(/hash mismatch/i);
    expect(existsSync(marker)).toBe(false);
  });

  it('assertAdapterHash throws on mismatch and passes on match', () => {
    const staged = writeStagedAdapter('unit', VALID_ADAPTER, '.ts');
    expect(() => assertAdapterHash(staged.adapterPath, staged.contentSha256)).not.toThrow();
    expect(() => assertAdapterHash(staged.adapterPath, '0'.repeat(64))).toThrow(/hash mismatch/i);
  });

  it('hashAdapterContent is sha256 hex of the utf8 bytes', () => {
    const expected = createHash('sha256').update(VALID_ADAPTER, 'utf8').digest('hex');
    expect(hashAdapterContent(VALID_ADAPTER)).toBe(expected);
  });

  it('installRegistry still stages then executes (CLI / seed path)', async () => {
    allowLocalUrlPolicy();
    const marker = join(tempDir, 'pwned.txt');
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(evilAdapter(marker), {
          headers: { 'content-type': 'application/typescript' },
        });
      },
    });
    try {
      const url = `http://127.0.0.1:${server.port}/adapter.ts`;
      const result = await installRegistry(
        { slug: 'cli', type: 'url', source: url },
        authFetch,
      );
      expect(result.manifest.id).toBe('unit');
      expect(result.contentSha256).toHaveLength(64);
      expect(existsSync(marker)).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('cleans up the managed dir when fetch fails after URL policy', async () => {
    allowLocalUrlPolicy();
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response('unavailable', { status: 503 });
      },
    });
    try {
      const url = `http://127.0.0.1:${server.port}/adapter.ts`;
      await expect(
        stageRegistry({ slug: 'unit', type: 'url', source: url }, authFetch),
      ).rejects.toThrow(/Failed to fetch/);
      expect(existsSync(join(managedDir, 'unit'))).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('rejects an adapter whose default export has the wrong shape on execute', async () => {
    writeStagedAdapter('badshape', 'export default { not_an_adapter: true };', '.ts');
    await expect(executeStagedRegistry('badshape')).rejects.toThrow(
      /does not export a valid RegistryAdapter/,
    );
  });

  it('getInstalledAdapterPath / removeInstalledAdapter round-trip without execute', () => {
    writeStagedAdapter('roundtrip', VALID_ADAPTER, '.ts');
    const p = getInstalledAdapterPath('roundtrip');
    expect(p).toBe(join(managedDir, 'roundtrip', 'adapter.ts'));
    removeInstalledAdapter('roundtrip');
    expect(getInstalledAdapterPath('roundtrip')).toBeNull();
  });
});
