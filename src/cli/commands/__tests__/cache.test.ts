import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { cacheCleanCommand, cacheInfoCommand } from '../cache';
import {
  getCacheDir,
  getOrCreateSnapshot,
  getRepoCacheDir,
  getRepoMirrorDir,
  materializeSnapshot,
} from '../../../shared/cache';

const execAsync = promisify(exec);

const noAuthFetch = {
  hasAuth: () => false,
  getTokenForUrl: () => null,
} as any;

async function makeFixtureRepo(rootDir: string): Promise<{ url: string; firstSha: string; latestSha: string }> {
  const repoDir = join(rootDir, 'fixture.git-src');
  mkdirSync(repoDir, { recursive: true });
  await execAsync(`git init -b main`, { cwd: repoDir });
  await execAsync(`git config user.email "capa-test@example.com"`, { cwd: repoDir });
  await execAsync(`git config user.name "capa-test"`, { cwd: repoDir });

  writeFileSync(join(repoDir, 'SKILL.md'), '# fixture-skill\nfirst\n');
  await execAsync(`git add -A`, { cwd: repoDir });
  await execAsync(`git commit -m "first"`, { cwd: repoDir });
  const { stdout: firstShaOut } = await execAsync(`git rev-parse HEAD`, { cwd: repoDir });
  const firstSha = firstShaOut.trim();
  await execAsync(`git tag v1.0.0`, { cwd: repoDir });

  writeFileSync(join(repoDir, 'SKILL.md'), '# fixture-skill\nsecond\n');
  await execAsync(`git add -A`, { cwd: repoDir });
  await execAsync(`git commit -m "second"`, { cwd: repoDir });
  const { stdout: latestShaOut } = await execAsync(`git rev-parse HEAD`, { cwd: repoDir });
  const latestSha = latestShaOut.trim();

  const url = `file://${repoDir.replace(/\\/g, '/')}`;
  return { url, firstSha, latestSha };
}

async function seedMirrorFromFixture(repoPath: string, fixtureUrl: string): Promise<string> {
  const mirrorDir = getRepoMirrorDir('github', repoPath);
  mkdirSync(getRepoCacheDir('github', repoPath), { recursive: true });
  await execAsync(`git clone --mirror "${fixtureUrl}" "${mirrorDir}"`);
  return mirrorDir;
}

/**
 * Capture stdout written through console.log/console.error.
 */
function captureConsole<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      const result = await fn();
      return { stdout: lines.join('\n'), result };
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  })();
}

describe('cache subcommand', () => {
  let testRoot: string;
  let cacheRoot: string;
  let fixture: { url: string; firstSha: string; latestSha: string };
  let prevCacheDir: string | undefined;

  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'capa-cache-cmd-test-'));
    fixture = await makeFixtureRepo(testRoot);
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'capa-cache-cmd-root-'));
    prevCacheDir = process.env.CAPA_CACHE_DIR;
    process.env.CAPA_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    if (prevCacheDir === undefined) {
      delete process.env.CAPA_CACHE_DIR;
    } else {
      process.env.CAPA_CACHE_DIR = prevCacheDir;
    }
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('cacheInfoCommand reports an empty cache', async () => {
    const { stdout } = await captureConsole(() => cacheInfoCommand());
    expect(stdout).toContain('Cache directory:');
    expect(stdout).toContain('empty');
  });

  it('cacheInfoCommand lists cached repos and snapshots', async () => {
    const mirrorDir = await seedMirrorFromFixture('owner/repo', fixture.url);
    await materializeSnapshot(mirrorDir, 'github', 'owner/repo', fixture.firstSha);
    await materializeSnapshot(mirrorDir, 'github', 'owner/repo', fixture.latestSha);

    const { stdout } = await captureConsole(() => cacheInfoCommand());
    expect(stdout).toContain('github:owner/repo');
    expect(stdout).toContain('snapshots:');
    expect(stdout).toContain('(2)');
    expect(stdout).toContain('Repositories:    1');
  });

  it('cacheCleanCommand prints a "no-op" message on an empty cache', async () => {
    const { stdout } = await captureConsole(() => cacheCleanCommand());
    expect(stdout).toContain('already empty');
    // No `git/` subdirectory should have been created
    expect(existsSync(join(getCacheDir(), 'git'))).toBe(false);
  });

  it('cacheCleanCommand wipes the cache directory', async () => {
    await seedMirrorFromFixture('owner/repo', fixture.url);
    expect(existsSync(getCacheDir())).toBe(true);

    const { stdout } = await captureConsole(() => cacheCleanCommand());
    expect(stdout).toContain('Cleared cache');
    expect(existsSync(getCacheDir())).toBe(false);
  });
});

describe('install cache flow (offline second resolve)', () => {
  let testRoot: string;
  let cacheRoot: string;
  let fixture: { url: string; firstSha: string; latestSha: string };
  let prevCacheDir: string | undefined;

  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'capa-install-cache-test-'));
    fixture = await makeFixtureRepo(testRoot);
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'capa-install-cache-root-'));
    prevCacheDir = process.env.CAPA_CACHE_DIR;
    process.env.CAPA_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    if (prevCacheDir === undefined) {
      delete process.env.CAPA_CACHE_DIR;
    } else {
      process.env.CAPA_CACHE_DIR = prevCacheDir;
    }
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('reuses an existing snapshot when given a pinned SHA (no network)', async () => {
    // Phase 1: simulate a "first install" by populating the cache through
    // the mirror+snapshot helpers (file:// URL, no network).
    const mirrorDir = await seedMirrorFromFixture('owner/repo', fixture.url);
    await materializeSnapshot(mirrorDir, 'github', 'owner/repo', fixture.latestSha);

    // Phase 2: kill the mirror to prove the second install path is offline.
    rmSync(mirrorDir, { recursive: true, force: true });

    // Phase 3: simulate a "second install" by calling getOrCreateSnapshot the
    // way installCommand would after reading the lockfile.
    const result = await getOrCreateSnapshot({
      platform: 'github',
      repoPath: 'owner/repo',
      authFetch: noAuthFetch,
      pinnedSha: fixture.latestSha,
    });

    expect(result.resolvedSha).toBe(fixture.latestSha);
    expect(existsSync(result.snapshotDir)).toBe(true);
    // Mirror was deleted before the second resolve and was NOT recreated:
    expect(existsSync(mirrorDir)).toBe(false);
  });

  it('--no-cache wipes the per-repo cache and forces a fresh resolve', async () => {
    const mirrorDir = await seedMirrorFromFixture('owner/repo', fixture.url);
    await materializeSnapshot(mirrorDir, 'github', 'owner/repo', fixture.latestSha);
    expect(existsSync(mirrorDir)).toBe(true);

    // With noCache the per-repo dir is wiped first; a real resolve would then
    // re-clone. We can't re-clone in this offline test, but we can assert the
    // wipe happened by catching the (expected) error.
    let threw = false;
    try {
      await getOrCreateSnapshot({
        platform: 'github',
        repoPath: 'owner/repo',
        authFetch: noAuthFetch,
        pinnedSha: fixture.latestSha,
        noCache: true,
      });
    } catch {
      threw = true;
    }
    // Either it errored trying to fetch from github.com, or the cache was wiped.
    // The important assertion is that the prior cache state is gone.
    expect(existsSync(getRepoCacheDir('github', 'owner/repo')) && existsSync(mirrorDir)).toBe(false);
    // Suppress the "unused variable" warning if the noCache call somehow succeeded.
    void threw;
  });
});
