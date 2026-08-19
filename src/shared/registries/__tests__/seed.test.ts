import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../config';
import * as cache from '../../cache';
import * as safeRemoteUrl from '../../safe-remote-url';
import { CapaDatabase } from '../../../db/database';
import { RegistryManager } from '../manager';
import {
  executeStagedRegistry,
  hashAdapterContent,
  writeStagedAdapter,
} from '../installer';
import { seedDefaultRegistries, DEFAULT_REGISTRIES } from '../seed';

const VALID_ADAPTER = `export default {
  manifest: { id: 'seed-demo', name: 'Seed Demo', capabilities: ['skills'] },
  search: async () => ({ items: [] }),
  view: async () => ({
    id: 'item', capability: 'skills', title: 'Item', preview: '',
    installSnippet: { id: 'item', type: 'inline', def: { content: '' } },
  }),
};`;

describe('seedDefaultRegistries', () => {
  let tempDir: string;
  let db: CapaDatabase;
  let manager: RegistryManager;
  let managedDirSpy: ReturnType<typeof spyOn>;
  let urlPolicySpy: ReturnType<typeof spyOn>;
  let server: ReturnType<typeof Bun.serve>;
  let goodUrl: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-seed-test-'));
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(
      join(tempDir, 'managed'),
    );
    urlPolicySpy = spyOn(safeRemoteUrl, 'assertPublicHttpsUrl').mockImplementation(
      async (urlString: string) => new URL(urlString),
    );
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new RegistryManager(db);

    const goodAdapterFile = join(tempDir, 'seed-good.ts');
    writeFileSync(goodAdapterFile, VALID_ADAPTER);

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith('/seed-good.ts')) {
          return new Response(readFileSync(goodAdapterFile, 'utf-8'), {
            headers: { 'content-type': 'application/typescript' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    goodUrl = `http://localhost:${server.port}/seed-good.ts`;
  });

  afterEach(() => {
    server.stop();
    urlPolicySpy.mockRestore();
    managedDirSpy.mockRestore();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('seeds the provided defaults on a fresh database', async () => {
    const result = await seedDefaultRegistries(db, manager, {
      seeds: [{ slug: 'a', type: 'url', source: goodUrl }],
    });
    expect(result.skipped).toBe(false);
    expect(result.installed).toEqual(['a']);
    expect(result.failed).toEqual([]);
    const row = db.getRegistry('a')!;
    expect(row.status).toBe('installed');
    expect(row.enabled).toBe(true);
  });

  it('marks the meta flag so subsequent runs are no-ops', async () => {
    await seedDefaultRegistries(db, manager, {
      seeds: [{ slug: 'a', type: 'url', source: goodUrl }],
    });
    expect(db.getMeta('registries_seeded_v1')).toBe('1');

    const second = await seedDefaultRegistries(db, manager, {
      seeds: [{ slug: 'b', type: 'url', source: goodUrl }],
    });
    expect(second.skipped).toBe(true);
    // The second pass must not create the new slug.
    expect(db.getRegistry('b')).toBeNull();
  });

  it('skips when the database already has registries', async () => {
    db.upsertRegistry({
      slug: 'pre-existing',
      type: 'url',
      source: goodUrl,
      status: 'installed',
    });
    const result = await seedDefaultRegistries(db, manager, {
      seeds: [{ slug: 'a', type: 'url', source: goodUrl }],
    });
    expect(result.skipped).toBe(true);
    expect(db.getRegistry('a')).toBeNull();
  });

  it('persists failed rows but still sets the seeded flag', async () => {
    const result = await seedDefaultRegistries(db, manager, {
      seeds: [
        { slug: 'good', type: 'url', source: goodUrl },
        { slug: 'broken', type: 'url', source: 'http://localhost:1/missing.ts' },
      ],
    });
    expect(result.skipped).toBe(false);
    expect(result.installed).toEqual(['good']);
    expect(result.failed.map((f) => f.slug)).toEqual(['broken']);

    const broken = db.getRegistry('broken')!;
    expect(broken.status).toBe('failed');
    expect(broken.lastError).toBeTruthy();

    expect(db.getMeta('registries_seeded_v1')).toBe('1');
  });

  it('default registry sources are pinned bundled adapters, not floating GitHub refs', () => {
    const floatingGithub = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/;
    const slugs = DEFAULT_REGISTRIES.map((r) => r.slug);
    expect(slugs).toEqual(['skills-sh', 'claude-plugins', 'cursor-marketplace']);
    for (const r of DEFAULT_REGISTRIES) {
      expect(r.source).not.toMatch(floatingGithub);
      expect(r.source.startsWith('infragate/capa@')).toBe(false);
      const pin = r.contentSha256 ?? '';
      expect(pin).toMatch(/^[a-f0-9]{64}$/);
      const adapterFile = join(import.meta.dir, '../../../../registries', r.slug, 'adapter.ts');
      if (existsSync(adapterFile)) {
        expect(hashAdapterContent(readFileSync(adapterFile, 'utf8'))).toBe(pin);
      }
    }
  });

  it('seeds bundled defaults from local adapter bytes without cloning GitHub', async () => {
    const snapshotSpy = spyOn(cache, 'getOrCreateSnapshot').mockRejectedValue(
      new Error('git clone must not run during default seed'),
    );
    try {
      const result = await seedDefaultRegistries(db, manager);
      expect(snapshotSpy).not.toHaveBeenCalled();
      expect(result.skipped).toBe(false);
      expect(result.failed).toEqual([]);
      expect([...result.installed].sort()).toEqual(
        ['claude-plugins', 'cursor-marketplace', 'skills-sh'].sort(),
      );
      for (const r of DEFAULT_REGISTRIES) {
        const row = db.getRegistry(r.slug)!;
        expect(row.status).toBe('installed');
        expect(row.contentSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(row.contentSha256).toBe(r.contentSha256 ?? null);
        const copied = join(tempDir, 'managed', r.slug, 'adapter.ts');
        expect(existsSync(copied)).toBe(true);
        expect(hashAdapterContent(readFileSync(copied, 'utf8'))).toBe(
          row.contentSha256 ?? '',
        );
      }
    } finally {
      snapshotSpy.mockRestore();
    }
  });

  it('refuses to execute a seeded adapter when bytes do not match the compiled pin', async () => {
    const seed = DEFAULT_REGISTRIES.find((r) => r.slug === 'claude-plugins')!;
    const pin = (seed as { contentSha256?: string }).contentSha256;
    expect(pin).toMatch(/^[a-f0-9]{64}$/);
    writeStagedAdapter('claude-plugins', 'export default { not_an_adapter: true };', '.ts');
    await expect(executeStagedRegistry('claude-plugins', pin)).rejects.toThrow(/hash mismatch/i);
  });
});
