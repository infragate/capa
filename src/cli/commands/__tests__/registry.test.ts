import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';
import {
  registryAddCommand,
  registryListCommand,
  registryRefreshCommand,
  registryRemoveCommand,
  registrySearchCommand,
  registrySetEnabledCommand,
} from '../registry';
import { setFlags } from '../../ui';

const VALID_ADAPTER = `export default {
  manifest: { id: 'demo-registry', name: 'Demo', capabilities: ['skills'] },
  search: async () => ({ items: [] }),
  view: async () => ({
    id: 'item', capability: 'skills', title: 'Item', preview: '',
    installSnippet: { id: 'item', type: 'inline', def: { content: '' } },
  }),
};`;

const BAD_ADAPTER = `export default { not_an_adapter: true };`;

describe('registry CLI commands', () => {
  let tempDir: string;
  let managedDir: string;
  let dbPath: string;
  let getDbPathSpy: ReturnType<typeof spyOn>;
  let getManagedDirSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let server: ReturnType<typeof Bun.serve>;
  let url: string;
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-cli-test-'));
    managedDir = join(tempDir, 'registries-managed');
    dbPath = join(tempDir, 'test.db');
    getDbPathSpy = spyOn(config, 'getDatabasePath').mockReturnValue(dbPath);
    getManagedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);

    // Convert process.exit calls into thrown errors so tests don't bail.
    originalProcessExit = process.exit;
    exitSpy = spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });

    const adapterFile = join(tempDir, 'adapter.ts');
    writeFileSync(adapterFile, VALID_ADAPTER);
    const badAdapterFile = join(tempDir, 'bad.ts');
    writeFileSync(badAdapterFile, BAD_ADAPTER);

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith('/adapter.ts')) {
          return new Response(readFileSync(adapterFile, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        if (path.endsWith('/bad.ts')) {
          return new Response(readFileSync(badAdapterFile, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    url = `http://localhost:${server.port}/adapter.ts`;
  });

  afterEach(() => {
    server.stop();
    exitSpy.mockRestore();
    process.exit = originalProcessExit;
    getDbPathSpy.mockRestore();
    getManagedDirSpy.mockRestore();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('add → list reflects an installed registry', async () => {
    await registryAddCommand(url, 'demo', { type: 'url' });

    const db = new CapaDatabase(dbPath);
    try {
      const records = db.listRegistries();
      expect(records).toHaveLength(1);
      expect(records[0].slug).toBe('demo');
      expect(records[0].type).toBe('url');
      expect(records[0].status).toBe('installed');
      expect(records[0].enabled).toBe(true);
      expect(records[0].installedAt).not.toBeNull();
    } finally {
      db.close();
    }
    expect(existsSync(join(managedDir, 'demo', 'adapter.ts'))).toBe(true);

    await registryListCommand();
  });

  it('add derives slug from URL when none is provided', async () => {
    await registryAddCommand(url, undefined, { type: 'url' });
    const db = new CapaDatabase(dbPath);
    try {
      const records = db.listRegistries();
      expect(records).toHaveLength(1);
      expect(records[0].slug).toBe('adapter');
    } finally {
      db.close();
    }
  });

  it('rejects duplicate slugs', async () => {
    await registryAddCommand(url, 'demo', { type: 'url' });
    await expect(registryAddCommand(url, 'demo', { type: 'url' })).rejects.toThrow(/process\.exit\(1\)/);
  });

  it('rejects invalid slugs', async () => {
    await expect(
      registryAddCommand(url, 'has space', { type: 'url' }),
    ).rejects.toThrow(/process\.exit\(1\)/);
  });

  it('add → remove leaves no record or files behind', async () => {
    await registryAddCommand(url, 'demo', { type: 'url' });
    expect(existsSync(join(managedDir, 'demo'))).toBe(true);

    await registryRemoveCommand('demo');

    const db = new CapaDatabase(dbPath);
    try {
      expect(db.listRegistries()).toHaveLength(0);
    } finally {
      db.close();
    }
    expect(existsSync(join(managedDir, 'demo'))).toBe(false);
  });

  it('refresh updates installedAt and resolved status', async () => {
    await registryAddCommand(url, 'demo', { type: 'url' });

    const db1 = new CapaDatabase(dbPath);
    const firstInstalledAt = db1.getRegistry('demo')!.installedAt!;
    db1.close();

    await Bun.sleep(5);
    await registryRefreshCommand('demo');

    const db2 = new CapaDatabase(dbPath);
    try {
      const r = db2.getRegistry('demo')!;
      expect(r.status).toBe('installed');
      expect(r.installedAt!).toBeGreaterThan(firstInstalledAt);
    } finally {
      db2.close();
    }
  });

  it('refresh marks the record as failed when the source becomes unreachable', async () => {
    await registryAddCommand(url, 'gone', { type: 'url' });

    // Repoint the stored source at a URL whose server no longer exists so
    // refresh fails at the fetch step (cleanly avoids module-import caching
    // on the same managed path).
    const deadUrl = `http://localhost:1/never-responds.ts`;
    const dbSet = new CapaDatabase(dbPath);
    dbSet.upsertRegistry({ slug: 'gone', type: 'url', source: deadUrl, status: 'installed' });
    dbSet.close();

    await expect(registryRefreshCommand('gone')).rejects.toThrow(/process\.exit\(1\)/);

    const db = new CapaDatabase(dbPath);
    try {
      const r = db.getRegistry('gone')!;
      expect(r.status).toBe('failed');
      expect(r.lastError).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('enable / disable toggles the enabled flag', async () => {
    await registryAddCommand(url, 'demo', { type: 'url' });
    await registrySetEnabledCommand('demo', false);

    const db = new CapaDatabase(dbPath);
    try {
      expect(db.getRegistry('demo')!.enabled).toBe(false);
    } finally {
      db.close();
    }

    await registrySetEnabledCommand('demo', true);

    const db2 = new CapaDatabase(dbPath);
    try {
      expect(db2.getRegistry('demo')!.enabled).toBe(true);
    } finally {
      db2.close();
    }
  });

  it('remove / refresh / enable error out cleanly when the slug is unknown', async () => {
    await expect(registryRemoveCommand('nope')).rejects.toThrow(/process\.exit\(1\)/);
    await expect(registryRefreshCommand('nope')).rejects.toThrow(/process\.exit\(1\)/);
    await expect(registrySetEnabledCommand('nope', true)).rejects.toThrow(/process\.exit\(1\)/);
  });
});

const SEARCH_ADAPTER_SKILLS = `export default {
  manifest: { id: 'search-one', name: 'Search One', capabilities: ['skills'] },
  search: async ({ query }) => ({
    items: [
      { id: 'foo-skill', capability: 'skills', title: 'Foo Skill', description: 'A skill matching ' + (query ?? '') },
      { id: 'bar-skill', capability: 'skills', title: 'Bar Skill', description: 'Another skill' },
    ],
  }),
  view: async () => ({
    id: 'foo-skill', capability: 'skills', title: 'Foo Skill', preview: '',
    installSnippet: { id: 'foo-skill', type: 'inline', def: { content: '' } },
  }),
};`;

const SEARCH_ADAPTER_PLUGINS = `export default {
  manifest: { id: 'search-two', name: 'Search Two', capabilities: ['plugins'] },
  search: async ({ query }) => ({
    items: [
      { id: 'baz-plugin', capability: 'plugins', title: 'Baz Plugin', description: 'A plugin matching ' + (query ?? '') },
    ],
  }),
  view: async () => ({
    id: 'baz-plugin', capability: 'plugins', title: 'Baz Plugin', preview: '',
    installSnippet: { id: 'baz-plugin', type: 'inline', def: { content: '' } },
  }),
};`;

const SEARCH_ADAPTER_THROWS = `export default {
  manifest: { id: 'search-broken', name: 'Search Broken', capabilities: ['skills'] },
  search: async () => { throw new Error('upstream exploded'); },
  view: async () => ({
    id: 'x', capability: 'skills', title: 'x', preview: '',
    installSnippet: { id: 'x', type: 'inline', def: { content: '' } },
  }),
};`;

describe('registry search CLI command', () => {
  let tempDir: string;
  let managedDir: string;
  let dbPath: string;
  let getDbPathSpy: ReturnType<typeof spyOn>;
  let getManagedDirSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let originalProcessExit: typeof process.exit;
  let server: ReturnType<typeof Bun.serve>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let logs: string[];
  let stdoutChunks: string[];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-search-test-'));
    managedDir = join(tempDir, 'registries-managed');
    dbPath = join(tempDir, 'test.db');
    getDbPathSpy = spyOn(config, 'getDatabasePath').mockReturnValue(dbPath);
    getManagedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);

    originalProcessExit = process.exit;
    exitSpy = spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });

    const skillsAdapter = join(tempDir, 'skills-adapter.ts');
    const pluginsAdapter = join(tempDir, 'plugins-adapter.ts');
    const brokenAdapter = join(tempDir, 'broken-adapter.ts');
    writeFileSync(skillsAdapter, SEARCH_ADAPTER_SKILLS);
    writeFileSync(pluginsAdapter, SEARCH_ADAPTER_PLUGINS);
    writeFileSync(brokenAdapter, SEARCH_ADAPTER_THROWS);

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith('/skills-adapter.ts')) {
          return new Response(readFileSync(skillsAdapter, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        if (path.endsWith('/plugins-adapter.ts')) {
          return new Response(readFileSync(pluginsAdapter, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        if (path.endsWith('/broken-adapter.ts')) {
          return new Response(readFileSync(brokenAdapter, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    logs = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    });
    stdoutChunks = [];
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    setFlags({ json: false, quiet: false, verbose: false });
    server.stop();
    consoleLogSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    process.exit = originalProcessExit;
    getDbPathSpy.mockRestore();
    getManagedDirSpy.mockRestore();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  async function installSearchRegistries(): Promise<{ skills: string; plugins: string; broken: string }> {
    const skillsUrl = `http://localhost:${server.port}/skills-adapter.ts`;
    const pluginsUrl = `http://localhost:${server.port}/plugins-adapter.ts`;
    const brokenUrl = `http://localhost:${server.port}/broken-adapter.ts`;
    await registryAddCommand(skillsUrl, 'search-one', { type: 'url' });
    await registryAddCommand(pluginsUrl, 'search-two', { type: 'url' });
    await registryAddCommand(brokenUrl, 'search-broken', { type: 'url' });
    return { skills: skillsUrl, plugins: pluginsUrl, broken: brokenUrl };
  }

  function resetCaptured(): void {
    logs.length = 0;
    stdoutChunks.length = 0;
  }

  function findJsonResults(): any {
    // The shared logger writes adapter-load messages to stdout, so the search's
    // JSON payload is one line among many. Pick the line that parses as a
    // search payload (has a `results` key).
    const lines = stdoutChunks.join('').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object' && 'results' in obj) return obj;
      } catch { /* not JSON */ }
    }
    throw new Error(`No search payload in stdout. Got:\n${lines.join('\n')}`);
  }

  it('searches a single registry by slug and prints a table', async () => {
    await installSearchRegistries();
    resetCaptured();

    await registrySearchCommand('foo', { slug: 'search-one' });

    const out = logs.join('\n');
    expect(out).toContain('Name');
    expect(out).toContain('Source');
    expect(out).toContain('Type');
    expect(out).toContain('Description');
    expect(out).toContain('foo-skill');
    expect(out).toContain('search-one');
    expect(out).toContain('skill');
    // Did not search the other registry.
    expect(out).not.toContain('baz-plugin');
  });

  it('searches all enabled registries when no slug is provided', async () => {
    await installSearchRegistries();
    await registrySetEnabledCommand('search-broken', false);
    resetCaptured();

    await registrySearchCommand('match');

    const out = logs.join('\n');
    expect(out).toContain('foo-skill');
    expect(out).toContain('baz-plugin');
    // search-broken was disabled, so it should not appear as a failure row.
    expect(out).not.toContain('search-broken');
  });

  it('emits a single JSON payload with --json', async () => {
    await installSearchRegistries();
    await registrySetEnabledCommand('search-broken', false);
    setFlags({ json: true });
    resetCaptured();

    await registrySearchCommand('hit', { slug: 'search-one' });

    const payload = findJsonResults();
    expect(payload.query).toBe('hit');
    expect(payload.total).toBe(2);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toMatchObject({
      id: 'foo-skill',
      source: 'search-one',
      type: 'skill',
      capability: 'skills',
    });
  });

  it('reports zero results without erroring out', async () => {
    await installSearchRegistries();
    await registrySetEnabledCommand('search-broken', false);
    await registrySetEnabledCommand('search-two', false);
    setFlags({ json: true });
    resetCaptured();

    // The skills adapter returns items regardless of query, so use a capability
    // filter the registry does not declare to produce empty results deterministically.
    await registrySearchCommand('anything', { slug: 'search-one', capability: 'plugins' });

    const payload = findJsonResults();
    expect(payload.total).toBe(0);
    expect(payload.results).toEqual([]);
  });

  it('errors when the slug is unknown', async () => {
    await installSearchRegistries();
    await expect(registrySearchCommand('x', { slug: 'nope' })).rejects.toThrow(/process\.exit\(1\)/);
  });

  it('errors when the slug is disabled', async () => {
    await installSearchRegistries();
    await registrySetEnabledCommand('search-one', false);
    await expect(registrySearchCommand('x', { slug: 'search-one' })).rejects.toThrow(/process\.exit\(1\)/);
  });

  it('errors when the query is empty', async () => {
    await installSearchRegistries();
    await expect(registrySearchCommand('   ')).rejects.toThrow(/process\.exit\(1\)/);
  });

  it('reports per-registry failures without dropping the rest of the results', async () => {
    await installSearchRegistries();
    setFlags({ json: true });
    resetCaptured();

    await registrySearchCommand('q');

    const payload = findJsonResults();
    expect(payload.failures).toBeDefined();
    expect(payload.failures.some((f: any) => f.slug === 'search-broken')).toBe(true);
    expect(payload.results.some((r: any) => r.source === 'search-one')).toBe(true);
    expect(payload.results.some((r: any) => r.source === 'search-two')).toBe(true);
  });
});
