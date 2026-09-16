import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase, DATABASE_BUSY_TIMEOUT_MS } from '../database';

describe('CapaDatabase busy timeout', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
  });

  it('waits for another process holding the write lock instead of failing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capa-db-busy-'));
    dirs.push(dir);
    const dbPath = join(dir, 'capa.db');
    const db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'p', path: '/p' });

    // Another process takes the write lock and holds it briefly.
    const holder = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const { Database } = require("bun:sqlite");
         const h = new Database(${JSON.stringify(dbPath)});
         h.run("BEGIN IMMEDIATE");
         console.log("locked");
         setTimeout(() => { h.run("COMMIT"); h.close(); }, 600);`,
      ],
      { stdout: 'pipe' },
    );
    const reader = holder.stdout.getReader();
    await reader.read(); // wait for "locked"

    const started = Date.now();
    expect(() => db.addManagedFile('p', join(dir, 'file'))).not.toThrow();
    expect(Date.now() - started).toBeLessThan(DATABASE_BUSY_TIMEOUT_MS);
    expect(db.getManagedFiles('p')).toEqual([join(dir, 'file')]);

    await holder.exited;
    db.close();
  });
});
