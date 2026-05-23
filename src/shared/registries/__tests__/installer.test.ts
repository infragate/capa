import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../config';
import { CapaDatabase } from '../../../db/database';
import { AuthenticatedFetch } from '../../authenticated-fetch';
import {
  installRegistry,
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

describe('installer — url installs', () => {
  let tempDir: string;
  let managedDir: string;
  let dbDir: string;
  let db: CapaDatabase;
  let managedDirSpy: ReturnType<typeof spyOn>;
  let authFetch: AuthenticatedFetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-installer-test-'));
    managedDir = join(tempDir, 'registries-managed');
    dbDir = join(tempDir, 'db');
    mkdirSync(dbDir, { recursive: true });
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);
    db = new CapaDatabase(join(dbDir, 'test.db'));
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

  it('installs an adapter from a localhost URL and validates its shape', async () => {
    const sourceFile = join(tempDir, 'served-adapter.ts');
    writeFileSync(sourceFile, VALID_ADAPTER);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith('/adapter.ts')) {
          return new Response(readFileSync(sourceFile, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    try {
      const url = `http://localhost:${server.port}/adapter.ts`;
      const result = await installRegistry(
        { slug: 'unit', type: 'url', source: url },
        authFetch,
      );
      expect(result.resolvedRef).toBeNull();
      expect(result.adapterPath).toBe(join(managedDir, 'unit', 'adapter.ts'));
      expect(result.manifest.id).toBe('unit');
      expect(existsSync(result.adapterPath)).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('rejects non-HTTPS URLs except localhost', async () => {
    await expect(
      installRegistry({ slug: 'unit', type: 'url', source: 'http://example.com/adapter.ts' }, authFetch),
    ).rejects.toThrow(/must use HTTPS/);
  });

  it('rejects URLs whose filename is not .ts/.js/.mjs', async () => {
    await expect(
      installRegistry({ slug: 'unit', type: 'url', source: 'https://example.com/adapter.txt' }, authFetch),
    ).rejects.toThrow(/\.ts, \.js, or \.mjs extension/);
  });

  it('rejects invalid slugs before any network access', async () => {
    await expect(
      installRegistry({ slug: 'has space', type: 'url', source: 'https://example.com/a.ts' }, authFetch),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('cleans up the managed dir when fetch fails', async () => {
    await expect(
      installRegistry(
        { slug: 'unit', type: 'url', source: 'https://example.invalid-host-name.test/a.ts' },
        authFetch,
      ),
    ).rejects.toThrow();
    expect(existsSync(join(managedDir, 'unit'))).toBe(false);
  });

  it('rejects an adapter file whose default export has the wrong shape', async () => {
    const sourceFile = join(tempDir, 'bad.ts');
    writeFileSync(sourceFile, 'export default { not_an_adapter: true };');

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(readFileSync(sourceFile, 'utf-8'), {
          headers: { 'content-type': 'application/typescript' },
        });
      },
    });
    try {
      const url = `http://localhost:${server.port}/adapter.ts`;
      await expect(
        installRegistry({ slug: 'badshape', type: 'url', source: url }, authFetch),
      ).rejects.toThrow(/does not export a valid RegistryAdapter/);
      expect(existsSync(join(managedDir, 'badshape'))).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('fetchAdapterSource returns the raw text without persisting', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(VALID_ADAPTER, {
          headers: { 'content-type': 'application/typescript' },
        });
      },
    });
    try {
      const url = `http://localhost:${server.port}/adapter.ts`;
      const { content, resolvedRef } = await fetchAdapterSource(
        { type: 'url', source: url },
        authFetch,
      );
      expect(content).toBe(VALID_ADAPTER);
      expect(resolvedRef).toBeNull();
      expect(existsSync(join(managedDir, 'preview-only'))).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('getInstalledAdapterPath / removeInstalledAdapter round-trip', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(VALID_ADAPTER, {
          headers: { 'content-type': 'application/typescript' },
        });
      },
    });
    try {
      const url = `http://localhost:${server.port}/adapter.ts`;
      await installRegistry({ slug: 'roundtrip', type: 'url', source: url }, authFetch);
      const p = getInstalledAdapterPath('roundtrip');
      expect(p).toBe(join(managedDir, 'roundtrip', 'adapter.ts'));
      removeInstalledAdapter('roundtrip');
      expect(getInstalledAdapterPath('roundtrip')).toBeNull();
    } finally {
      server.stop();
    }
  });
});
