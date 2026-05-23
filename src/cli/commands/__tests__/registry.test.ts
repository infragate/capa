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
  registrySetEnabledCommand,
} from '../registry';

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
