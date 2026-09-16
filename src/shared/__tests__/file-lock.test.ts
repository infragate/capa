import { describe, expect, it, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
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

  it('keeps mutual exclusion when many processes race to take over a stale lock', async () => {
    const dir = tempDir();
    const lockPath = join(dir, '.plugin.lock');
    const log = join(dir, 'log.txt');
    writeFileSync(lockPath, '999999999'); // stale: dead pid
    const worker = `
      const { appendFileSync } = require("fs");
      const { acquireFileLock } = require(${JSON.stringify(join(import.meta.dir, '..', 'file-lock.ts'))});
      for (let i = 0; i < 3; i++) {
        const release = await acquireFileLock(${JSON.stringify(lockPath)}, { timeoutMs: 30000, pollMs: 5 });
        appendFileSync(${JSON.stringify(log)}, "enter " + process.pid + "\\n");
        await Bun.sleep(15);
        appendFileSync(${JSON.stringify(log)}, "exit " + process.pid + "\\n");
        release();
      }`;
    const procs = Array.from({ length: 6 }, () =>
      Bun.spawn([process.execPath, '-e', worker], { stdout: 'ignore', stderr: 'inherit' }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes.every((c) => c === 0)).toBe(true);

    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines.length).toBe(6 * 3 * 2);
    let holder: string | null = null;
    for (const line of lines) {
      const [event, pid] = line.split(' ');
      if (event === 'enter') {
        expect(holder).toBeNull();
        holder = pid;
      } else {
        expect(holder).toBe(pid);
        holder = null;
      }
    }
    expect(existsSync(lockPath)).toBe(false);
    expect(readdirSync(dir).filter((f) => f !== 'log.txt')).toEqual([]);
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
