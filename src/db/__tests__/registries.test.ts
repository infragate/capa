import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CapaDatabase } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CapaDatabase — registry operations', () => {
  let db: CapaDatabase;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-registries-db-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('returns empty list when no registries are configured', () => {
    expect(db.listRegistries()).toEqual([]);
  });

  it('upserts a new registry with default enabled=true and status=pending', () => {
    const record = db.upsertRegistry({
      slug: 'skills-sh',
      type: 'github',
      source: 'infragate/capa@skills-sh',
    });
    expect(record.slug).toBe('skills-sh');
    expect(record.type).toBe('github');
    expect(record.source).toBe('infragate/capa@skills-sh');
    expect(record.enabled).toBe(true);
    expect(record.status).toBe('pending');
    expect(record.lastError).toBeNull();
    expect(record.resolvedRef).toBeNull();
    expect(record.installedAt).toBeNull();
    expect(record.createdAt).toBeGreaterThan(0);
    expect(record.updatedAt).toBe(record.createdAt);
  });

  it('round-trips through getRegistry', () => {
    db.upsertRegistry({ slug: 's1', type: 'url', source: 'https://example.com/adapter.ts' });
    const found = db.getRegistry('s1');
    expect(found).not.toBeNull();
    expect(found!.type).toBe('url');
    expect(found!.source).toBe('https://example.com/adapter.ts');
  });

  it('returns null when getting a non-existent slug', () => {
    expect(db.getRegistry('does-not-exist')).toBeNull();
  });

  it('upsert is idempotent on the slug and updates updated_at', async () => {
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    const initial = db.getRegistry('s1')!;
    await Bun.sleep(2);
    const updated = db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c-new' });
    expect(updated.source).toBe('a/b@c-new');
    expect(updated.updatedAt).toBeGreaterThan(initial.updatedAt);
    expect(updated.createdAt).toBe(initial.createdAt);
    expect(db.listRegistries()).toHaveLength(1);
  });

  it('setRegistryStatus updates status and lastError', () => {
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    db.setRegistryStatus('s1', 'failed', 'network error');
    const r = db.getRegistry('s1')!;
    expect(r.status).toBe('failed');
    expect(r.lastError).toBe('network error');
  });

  it('setRegistryStatus clears lastError when called without one', () => {
    db.upsertRegistry({
      slug: 's1',
      type: 'github',
      source: 'a/b@c',
      status: 'failed',
      lastError: 'previous',
    });
    db.setRegistryStatus('s1', 'installed');
    const r = db.getRegistry('s1')!;
    expect(r.status).toBe('installed');
    expect(r.lastError).toBeNull();
  });

  it('setRegistryEnabled toggles the enabled flag', () => {
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    db.setRegistryEnabled('s1', false);
    expect(db.getRegistry('s1')!.enabled).toBe(false);
    db.setRegistryEnabled('s1', true);
    expect(db.getRegistry('s1')!.enabled).toBe(true);
  });

  it('deleteRegistry removes the row', () => {
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    db.deleteRegistry('s1');
    expect(db.getRegistry('s1')).toBeNull();
    expect(db.listRegistries()).toEqual([]);
  });

  it('delete is a no-op for an unknown slug', () => {
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    db.deleteRegistry('other');
    expect(db.listRegistries()).toHaveLength(1);
  });

  it('rejects an invalid type via CHECK constraint', () => {
    expect(() =>
      db.upsertRegistry({ slug: 's1', type: 'ftp' as any, source: 'whatever' }),
    ).toThrow();
  });

  it('rejects an invalid status via CHECK constraint', () => {
    expect(() =>
      db.upsertRegistry({
        slug: 's1',
        type: 'github',
        source: 'a/b@c',
        status: 'weird' as any,
      }),
    ).toThrow();
  });

  it('persists resolvedRef and installedAt and preserves them on partial upsert', () => {
    const t = Date.now();
    db.upsertRegistry({
      slug: 's1',
      type: 'github',
      source: 'a/b@c',
      status: 'installed',
      resolvedRef: 'abc1234',
      installedAt: t,
    });
    db.upsertRegistry({ slug: 's1', type: 'github', source: 'a/b@c' });
    const r = db.getRegistry('s1')!;
    expect(r.resolvedRef).toBe('abc1234');
    expect(r.installedAt).toBe(t);
    expect(r.status).toBe('installed');
  });

  it('list returns registries in creation order', async () => {
    db.upsertRegistry({ slug: 'a', type: 'github', source: 'x/y@a' });
    await Bun.sleep(2);
    db.upsertRegistry({ slug: 'b', type: 'github', source: 'x/y@b' });
    await Bun.sleep(2);
    db.upsertRegistry({ slug: 'c', type: 'github', source: 'x/y@c' });
    expect(db.listRegistries().map((r) => r.slug)).toEqual(['a', 'b', 'c']);
  });
});
