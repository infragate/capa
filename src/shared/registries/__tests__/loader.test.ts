import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../config';
import { CapaDatabase } from '../../../db/database';
import { RegistryLoader } from '../loader';

const VALID_ADAPTER = `export default {
  manifest: { id: 'good-registry', name: 'Good', capabilities: ['skills'] },
  search: async () => ({ items: [] }),
  view: async () => ({
    id: 'item',
    capability: 'skills',
    title: 'Item',
    preview: '',
    installSnippet: { id: 'item', type: 'inline', def: { content: '' } },
  }),
};`;

describe('RegistryLoader', () => {
  let tempDir: string;
  let managedDir: string;
  let db: CapaDatabase;
  let managedDirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-loader-test-'));
    managedDir = join(tempDir, 'registries-managed');
    mkdirSync(managedDir, { recursive: true });
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);
    db = new CapaDatabase(join(tempDir, 'test.db'));
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

  function writeAdapter(slug: string, body: string): void {
    const dir = join(managedDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'adapter.js'), body);
  }

  it('loads adapters whose DB row is installed and enabled', async () => {
    writeAdapter('good', VALID_ADAPTER);
    db.upsertRegistry({
      slug: 'good',
      type: 'github',
      source: 'a/b@good',
      status: 'installed',
    });

    const loader = new RegistryLoader(db);
    const { adapters, failures } = await loader.loadAll();

    expect(adapters.size).toBe(1);
    expect(adapters.get('good-registry')?.manifest.name).toBe('Good');
    expect(failures).toBeUndefined();
  });

  it('skips disabled registries', async () => {
    writeAdapter('off', VALID_ADAPTER);
    db.upsertRegistry({
      slug: 'off',
      type: 'github',
      source: 'a/b@off',
      status: 'installed',
      enabled: false,
    });

    const { adapters } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(0);
  });

  it('skips registries with non-installed status', async () => {
    writeAdapter('failed', VALID_ADAPTER);
    db.upsertRegistry({
      slug: 'failed',
      type: 'github',
      source: 'a/b@failed',
      status: 'failed',
      lastError: 'boom',
    });

    const { adapters } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(0);
  });

  it('records a failure when the materialized adapter file is missing', async () => {
    db.upsertRegistry({
      slug: 'missing',
      type: 'github',
      source: 'a/b@missing',
      status: 'installed',
    });

    const { adapters, failures } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures![0].slug).toBe('missing');
    expect(failures![0].error).toMatch(/No materialized adapter file/);
  });

  it('records a failure when the adapter file throws on import', async () => {
    writeAdapter('boom', 'throw new Error("adapter boom");');
    db.upsertRegistry({
      slug: 'boom',
      type: 'github',
      source: 'a/b@boom',
      status: 'installed',
    });

    const { adapters, failures } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures![0].slug).toBe('boom');
    expect(failures![0].error).toBe('adapter boom');
  });

  it('records a failure when the default export has the wrong shape', async () => {
    writeAdapter('wrong', 'export default { not_an_adapter: true };');
    db.upsertRegistry({
      slug: 'wrong',
      type: 'github',
      source: 'a/b@wrong',
      status: 'installed',
    });

    const { adapters, failures } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures![0].error).toMatch(/does not export a valid RegistryAdapter/);
  });

  it('deduplicates by manifest id across slugs', async () => {
    writeAdapter('a', VALID_ADAPTER);
    writeAdapter('b', VALID_ADAPTER);
    db.upsertRegistry({ slug: 'a', type: 'github', source: 'x/y@a', status: 'installed' });
    db.upsertRegistry({ slug: 'b', type: 'github', source: 'x/y@b', status: 'installed' });

    const { adapters, failures } = await new RegistryLoader(db).loadAll();
    expect(adapters.size).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures![0].error).toMatch(/Duplicate registry id/);
  });
});
