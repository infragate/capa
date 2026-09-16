import { describe, expect, it, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireFileLock } from '../file-lock';

describe('acquireFileLock', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
  });
  const tempDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'capa-file-lock-'));
    dirs.push(d);
    return d;
  };

  it('waits for another process to release the lock', async () => {
    const lockPath = join(tempDir(), '.plugin.lock');
    const holder = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const { acquireFileLock } = require(${JSON.stringify(join(import.meta.dir, '..', 'file-lock.ts'))});
         const release = await acquireFileLock(${JSON.stringify(lockPath)});
         console.log("held");
         await Bun.sleep(500);
         release();`,
      ],
      { stdout: 'pipe' },
    );
    await holder.stdout.getReader().read(); // "held"

    const started = Date.now();
    const release = await acquireFileLock(lockPath, { timeoutMs: 10_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    release();
    expect(existsSync(lockPath)).toBe(false);
    await holder.exited;
  });

  it('takes over a lock left by a dead process', async () => {
    const lockPath = join(tempDir(), '.plugin.lock');
    writeFileSync(lockPath, '999999999');
    const release = await acquireFileLock(lockPath, { timeoutMs: 1000 });
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('times out when a live process keeps the lock', async () => {
    const lockPath = join(tempDir(), '.plugin.lock');
    writeFileSync(lockPath, String(process.pid));
    await expect(acquireFileLock(lockPath, { timeoutMs: 150 })).rejects.toThrow(/Timed out/);
  });
});
