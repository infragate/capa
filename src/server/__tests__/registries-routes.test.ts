import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { RegistryManager } from '../../shared/registries/manager';
import {
  listRegistriesHandler,
  createRegistryHandler,
  deleteRegistryHandler,
  patchRegistryHandler,
  refreshRegistryHandler,
  previewRegistryHandler,
} from '../registries-routes';

const VALID_ADAPTER = `export default {
  manifest: { id: 'demo-registry', name: 'Demo', capabilities: ['skills'] },
  search: async () => ({ items: [] }),
  view: async () => ({
    id: 'item', capability: 'skills', title: 'Item', preview: '',
    installSnippet: { id: 'item', type: 'inline', def: { content: '' } },
  }),
};`;

const BAD_ADAPTER = `export default { not_an_adapter: true };`;

async function jsonOf(res: Response): Promise<any> {
  return res.json();
}

describe('registries-routes', () => {
  let tempDir: string;
  let managedDir: string;
  let db: CapaDatabase;
  let manager: RegistryManager;
  let managedDirSpy: ReturnType<typeof spyOn>;
  let server: ReturnType<typeof Bun.serve>;
  let goodUrl: string;
  let badUrl: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registry-routes-test-'));
    managedDir = join(tempDir, 'registries-managed');
    managedDirSpy = spyOn(config, 'getManagedRegistriesDir').mockReturnValue(managedDir);
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new RegistryManager(db);

    const goodAdapterFile = join(tempDir, 'good.ts');
    const badAdapterFile = join(tempDir, 'bad.ts');
    writeFileSync(goodAdapterFile, VALID_ADAPTER);
    writeFileSync(badAdapterFile, BAD_ADAPTER);

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith('/good.ts')) {
          return new Response(readFileSync(goodAdapterFile, 'utf-8'), {
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
    goodUrl = `http://localhost:${server.port}/good.ts`;
    badUrl = `http://localhost:${server.port}/bad.ts`;
  });

  afterEach(() => {
    server.stop();
    managedDirSpy.mockRestore();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  describe('GET /api/registries', () => {
    it('returns an empty list when nothing is configured', async () => {
      const res = await listRegistriesHandler(db, manager);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.registries).toEqual([]);
    });

    it('includes failed and disabled rows alongside installed ones', async () => {
      db.upsertRegistry({ slug: 'a', type: 'github', source: 'x/y@a', status: 'installed' });
      db.upsertRegistry({
        slug: 'b',
        type: 'url',
        source: 'https://x/b.ts',
        status: 'failed',
        lastError: 'boom',
      });
      db.upsertRegistry({
        slug: 'c',
        type: 'github',
        source: 'x/y@c',
        status: 'installed',
        enabled: false,
      });

      const res = await listRegistriesHandler(db, manager);
      const body = await jsonOf(res);
      expect(body.registries.map((r: any) => r.slug).sort()).toEqual(['a', 'b', 'c']);
      const b = body.registries.find((r: any) => r.slug === 'b');
      expect(b.status).toBe('failed');
      expect(b.lastError).toBe('boom');
    });
  });

  describe('POST /api/registries', () => {
    it('installs from a URL and returns 201 with the new record', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl, slug: 'unit' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.registry.slug).toBe('unit');
      expect(body.registry.status).toBe('installed');
      expect(body.manifest.id).toBe('demo-registry');
      expect(existsSync(join(managedDir, 'unit', 'adapter.ts'))).toBe(true);
    });

    it('derives the slug when not provided', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.registry.slug).toBe('good');
    });

    it('rejects bodies missing type or source', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(400);
      const body = await jsonOf(res);
      expect(body.error).toMatch(/source/);
    });

    it('rejects malformed JSON', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: '{not json',
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/Invalid JSON/);
    });

    it('rejects invalid type values', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'ftp', source: 'https://example.com/a.ts' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/type/);
    });

    it('rejects invalid slug formats', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl, slug: 'has space' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/Invalid slug/);
    });

    it('returns 409 on slug collision', async () => {
      db.upsertRegistry({ slug: 'unit', type: 'github', source: 'x/y@a', status: 'installed' });
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl, slug: 'unit' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(409);
    });

    it('returns 400 when the fetched adapter is malformed', async () => {
      const req = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: badUrl, slug: 'bad' }),
      });
      const res = await createRegistryHandler(db, manager, req);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/does not export a valid RegistryAdapter/);
      expect(db.getRegistry('bad')).toBeNull();
    });
  });

  describe('DELETE /api/registries/:slug', () => {
    it('returns 404 when the slug is unknown', async () => {
      const res = await deleteRegistryHandler(db, manager, 'missing');
      expect(res.status).toBe(404);
    });

    it('removes the row and the materialized files', async () => {
      const create = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl, slug: 'gone' }),
      });
      await createRegistryHandler(db, manager, create);
      expect(existsSync(join(managedDir, 'gone'))).toBe(true);

      const res = await deleteRegistryHandler(db, manager, 'gone');
      expect(res.status).toBe(204);
      expect(db.getRegistry('gone')).toBeNull();
      expect(existsSync(join(managedDir, 'gone'))).toBe(false);
    });
  });

  describe('PATCH /api/registries/:slug', () => {
    it('toggles the enabled flag', async () => {
      db.upsertRegistry({ slug: 'unit', type: 'github', source: 'x/y@u', status: 'installed' });
      const req = new Request('http://localhost/api/registries/unit', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      const res = await patchRegistryHandler(db, manager, 'unit', req);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.registry.enabled).toBe(false);
    });

    it('rejects bodies missing the enabled boolean', async () => {
      db.upsertRegistry({ slug: 'unit', type: 'github', source: 'x/y@u', status: 'installed' });
      const req = new Request('http://localhost/api/registries/unit', {
        method: 'PATCH',
        body: JSON.stringify({ other: 1 }),
      });
      const res = await patchRegistryHandler(db, manager, 'unit', req);
      expect(res.status).toBe(400);
    });

    it('returns 404 when the slug is unknown', async () => {
      const req = new Request('http://localhost/api/registries/x', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      });
      const res = await patchRegistryHandler(db, manager, 'x', req);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/registries/:slug/refresh', () => {
    it('re-installs and updates installed_at', async () => {
      const create = new Request('http://localhost/api/registries', {
        method: 'POST',
        body: JSON.stringify({ type: 'url', source: goodUrl, slug: 'r' }),
      });
      await createRegistryHandler(db, manager, create);
      const firstInstalledAt = db.getRegistry('r')!.installedAt!;
      await Bun.sleep(5);
      const res = await refreshRegistryHandler(db, manager, 'r');
      expect(res.status).toBe(200);
      expect(db.getRegistry('r')!.installedAt!).toBeGreaterThan(firstInstalledAt);
    });

    it('marks the row as failed when the source is unreachable', async () => {
      db.upsertRegistry({
        slug: 'broken',
        type: 'url',
        source: 'http://localhost:1/never.ts',
        status: 'installed',
      });
      const res = await refreshRegistryHandler(db, manager, 'broken');
      expect(res.status).toBe(400);
      const r = db.getRegistry('broken')!;
      expect(r.status).toBe('failed');
      expect(r.lastError).toBeTruthy();
    });

    it('returns 404 when the slug is unknown', async () => {
      const res = await refreshRegistryHandler(db, manager, 'nope');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/registries/preview', () => {
    it('returns the raw adapter source without persisting', async () => {
      const url = new URL(`http://localhost/api/registries/preview?type=url&source=${encodeURIComponent(goodUrl)}`);
      const res = await previewRegistryHandler(db, url);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.content).toBe(VALID_ADAPTER);
      expect(body.derivedSlug).toBe('good');
      expect(db.listRegistries()).toEqual([]);
      expect(existsSync(join(managedDir, 'good'))).toBe(false);
    });

    it('rejects requests without required query params', async () => {
      const url = new URL('http://localhost/api/registries/preview');
      const res = await previewRegistryHandler(db, url);
      expect(res.status).toBe(400);
    });

    it('returns 400 when the fetch itself fails', async () => {
      const url = new URL(
        `http://localhost/api/registries/preview?type=url&source=${encodeURIComponent('http://localhost:1/none.ts')}`,
      );
      const res = await previewRegistryHandler(db, url);
      expect(res.status).toBe(400);
    });
  });
});
