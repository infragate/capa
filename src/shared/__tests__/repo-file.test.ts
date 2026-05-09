import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { assertSafeRepoPath, fetchRepoFile, fetchTextFile, looksLikeHtmlPage } from '../repo-file';
import { getOrCreateSnapshot, getRepoCacheDir, getRepoMirrorDir } from '../cache';
import type { CachePlatform } from '../cache';

const execAsync = promisify(exec);

const noAuthFetch = {
  hasAuth: () => false,
  getTokenForUrl: () => null,
  fetch: async (url: string, init?: RequestInit) => fetch(url, init),
} as any;

async function makeFixtureRepo(rootDir: string): Promise<{
  url: string;
  firstSha: string;
  latestSha: string;
  tag: string;
}> {
  const repoDir = join(rootDir, 'fixture.git-src');
  mkdirSync(repoDir, { recursive: true });
  await execAsync('git init -b main', { cwd: repoDir });
  await execAsync('git config user.email "capa-test@example.com"', { cwd: repoDir });
  await execAsync('git config user.name "capa-test"', { cwd: repoDir });

  // Layout exercises both `::` exact paths and `@` recursive search:
  //   /AGENTS.md                       (single file at root)
  //   /rules/git-conventions.md        (uniquely named — search by basename works)
  //   /docs/notes.md                   (unique; used for search-by-basename)
  //   /a/dup.md   /b/dup.md            (duplicate basename — search must error)
  mkdirSync(join(repoDir, 'rules'), { recursive: true });
  mkdirSync(join(repoDir, 'docs'), { recursive: true });
  mkdirSync(join(repoDir, 'a'), { recursive: true });
  mkdirSync(join(repoDir, 'b'), { recursive: true });
  writeFileSync(join(repoDir, 'AGENTS.md'), '# Agents v1\n');
  writeFileSync(join(repoDir, 'rules', 'git-conventions.md'), '# Git rules v1\n');
  writeFileSync(join(repoDir, 'docs', 'notes.md'), '# notes\n');
  writeFileSync(join(repoDir, 'a', 'dup.md'), '# dup-a\n');
  writeFileSync(join(repoDir, 'b', 'dup.md'), '# dup-b\n');
  await execAsync('git add -A', { cwd: repoDir });
  await execAsync('git commit -m "first"', { cwd: repoDir });
  const { stdout: firstShaOut } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
  const firstSha = firstShaOut.trim();
  await execAsync('git tag v1.0.0', { cwd: repoDir });

  writeFileSync(join(repoDir, 'AGENTS.md'), '# Agents v2\n');
  await execAsync('git add -A', { cwd: repoDir });
  await execAsync('git commit -m "second"', { cwd: repoDir });
  const { stdout: latestShaOut } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
  const latestSha = latestShaOut.trim();

  const url = `file://${repoDir.replace(/\\/g, '/')}`;
  return { url, firstSha, latestSha, tag: 'v1.0.0' };
}

async function seedMirrorFromFixture(
  platform: CachePlatform,
  repoPath: string,
  fixtureUrl: string
): Promise<string> {
  const mirrorDir = getRepoMirrorDir(platform, repoPath);
  mkdirSync(getRepoCacheDir(platform, repoPath), { recursive: true });
  await execAsync(`git clone --mirror "${fixtureUrl}" "${mirrorDir}"`);
  return mirrorDir;
}

describe('looksLikeHtmlPage', () => {
  it('flags responses with text/html content-type', () => {
    expect(looksLikeHtmlPage('hello', 'text/html; charset=utf-8')).toBe(true);
    expect(looksLikeHtmlPage('hello', 'application/xhtml+xml')).toBe(true);
  });

  it('flags bodies starting with a doctype declaration', () => {
    expect(looksLikeHtmlPage('<!DOCTYPE html>\n<html>', null)).toBe(true);
    expect(looksLikeHtmlPage('  <!doctype html>', null)).toBe(true);
  });

  it('flags bodies starting with <html tag', () => {
    expect(looksLikeHtmlPage('<html lang="en">\n<head>', null)).toBe(true);
    expect(looksLikeHtmlPage('  <html>', 'text/plain')).toBe(true);
  });

  it('passes plain markdown content', () => {
    expect(looksLikeHtmlPage('# Hello\n\nThis is markdown.', 'text/markdown')).toBe(false);
    expect(looksLikeHtmlPage('---\nname: foo\n---\n\nbody', 'text/plain')).toBe(false);
    expect(looksLikeHtmlPage('Some <html> reference inside text', null)).toBe(false);
  });
});

describe('fetchTextFile', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the response body for a successful markdown fetch', async () => {
    globalThis.fetch = (async () =>
      new Response('# Hello\n', {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
      })) as any;

    const body = await fetchTextFile('https://example.com/foo.md');
    expect(body).toBe('# Hello\n');
  });

  it('throws when the response is HTML (likely an SSO login redirect)', async () => {
    globalThis.fetch = (async () =>
      new Response('<!DOCTYPE html><html><head><title>SAML SSO</title></head></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as any;

    await expect(
      fetchTextFile('https://gitlab.com/private/repo/-/raw/main/AGENTS.md', {
        sourceLabel: 'agents.base',
      })
    ).rejects.toThrow(/HTML/);
  });

  it('mentions the typed source fix in the HTML error message', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>login</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as any;

    let caught: Error | null = null;
    try {
      await fetchTextFile('https://gitlab.com/x/y/-/raw/main/foo.md');
    } catch (err: any) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('type: gitlab');
    expect(caught!.message).toContain('def');
  });

  it('throws on non-OK responses', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404, statusText: 'Not Found' })) as any;

    await expect(fetchTextFile('https://example.com/missing.md')).rejects.toThrow(/404/);
  });

  it('uses authFetch.fetch when an auth helper is supplied', async () => {
    let calledThroughAuth = false;
    const auth = {
      fetch: async (_url: string) => {
        calledThroughAuth = true;
        return new Response('# private\n', {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        });
      },
    } as any;

    const body = await fetchTextFile('https://example.com/private.md', { authFetch: auth });
    expect(calledThroughAuth).toBe(true);
    expect(body).toBe('# private\n');
  });
});

describe('fetchRepoFile', () => {
  let testRoot: string;
  let cacheRoot: string;
  let fixture: { url: string; firstSha: string; latestSha: string; tag: string };
  let prevCacheDir: string | undefined;

  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'capa-repo-file-test-'));
    fixture = await makeFixtureRepo(testRoot);
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'capa-repo-file-cache-'));
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

  // git on Windows can rewrite checkout line endings depending on
  // core.autocrlf, so normalize before comparing markdown bodies.
  const norm = (s: string) => s.replace(/\r\n/g, '\n');

  // Convenience binding for the verbose snapshot resolver shim.
  const snap = (platform: any, repoPath: string, authFetch: any, opts: any) =>
    getOrCreateSnapshot({ platform, repoPath, authFetch, ...opts });

  describe(':: form (exact path)', () => {
    it('reads a file at the latest semver tag when no ref is specified', async () => {
      // The cache layer defaults unpinned requests to the latest semver tag, so
      // an unqualified "owner/repo::AGENTS.md" resolves to the v1.0.0 commit.
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        'owner/repo::AGENTS.md',
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# Agents v1\n');
      expect(result.resolvedSha).toBe(fixture.firstSha);
      expect(result.resolvedVersion).toBe('v1.0.0');
    });

    it('reads a file pinned to a SHA (latest commit)', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        `owner/repo::AGENTS.md#${fixture.latestSha}`,
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# Agents v2\n');
      expect(result.resolvedSha).toBe(fixture.latestSha);
    });

    it('reads a file pinned to a tag (v1.0.0)', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        'owner/repo::AGENTS.md:v1.0.0',
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# Agents v1\n');
      expect(result.resolvedSha).toBe(fixture.firstSha);
      expect(result.resolvedVersion).toBe('v1.0.0');
    });

    it('reads a nested file path from a snapshot', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        'owner/repo::rules/git-conventions.md',
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# Git rules v1\n');
    });

    it('throws when the file is missing in the snapshot', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      await expect(
        fetchRepoFile('github', 'owner/repo::does/not/exist.md', snap, noAuthFetch)
      ).rejects.toThrow(/not found/);
    });

    it('throws when the repo string has no separator', async () => {
      await expect(
        fetchRepoFile('github', 'owner/repo', snap, noAuthFetch)
      ).rejects.toThrow(/Invalid repo format/);
    });
  });

  describe('@ form (recursive search by basename)', () => {
    it('finds a uniquely-named file recursively', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        'owner/repo@git-conventions.md',
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# Git rules v1\n');
    });

    it('finds a file at the repo root via search', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      const result = await fetchRepoFile(
        'github',
        'owner/repo@notes.md',
        snap,
        noAuthFetch
      );
      expect(norm(result.content)).toBe('# notes\n');
    });

    it('throws when no file matches the basename, listing candidates', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      let err: Error | null = null;
      try {
        await fetchRepoFile('github', 'owner/repo@nope.md', snap, noAuthFetch);
      } catch (e: any) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/No file named "nope\.md"/);
      expect(err!.message).toMatch(/owner\/repo::path\/to\/nope\.md/);
      // The candidate list should mention some other .md files in the repo.
      expect(err!.message).toMatch(/AGENTS\.md|notes\.md|git-conventions\.md|dup\.md/);
    });

    it('throws when multiple files share the basename, listing matches', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      let err: Error | null = null;
      try {
        await fetchRepoFile('github', 'owner/repo@dup.md', snap, noAuthFetch);
      } catch (e: any) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/Ambiguous reference/);
      expect(err!.message).toContain('a/dup.md');
      expect(err!.message).toContain('b/dup.md');
      expect(err!.message).toMatch(/owner\/repo::<exact-path>/);
    });
  });

  // Targeted regression tests for the path-traversal guard. A capabilities
  // file is the kind of input a user might pull from another team's repo, so
  // we want to ensure that even hostile `::` targets cannot read files
  // outside the snapshot directory.
  describe('path-traversal guard (:: form)', () => {
    it('rejects parent-directory segments', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      await expect(
        fetchRepoFile('github', 'owner/repo::../../etc/passwd', snap, noAuthFetch)
      ).rejects.toThrow(/parent-directory|outside the repository/i);
    });

    it('rejects POSIX-style absolute paths', async () => {
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      await expect(
        fetchRepoFile('github', 'owner/repo::/etc/passwd', snap, noAuthFetch)
      ).rejects.toThrow(/absolute paths/i);
    });

    it('rejects Windows-style root-relative paths starting with backslash', async () => {
      // We cannot reach this guard with `::C:/…` because parseRepoString
      // would split the `:` after `C` as a version suffix; but a leading
      // backslash makes it through cleanly.
      await seedMirrorFromFixture('github', 'owner/repo', fixture.url);
      await expect(
        fetchRepoFile('github', 'owner/repo::\\Windows\\System32', snap, noAuthFetch)
      ).rejects.toThrow(/absolute paths/i);
    });
  });
});

describe('assertSafeRepoPath', () => {
  const root = '/tmp/capa-fake-snapshot';

  it('accepts simple relative paths', () => {
    expect(() => assertSafeRepoPath(root, 'AGENTS.md')).not.toThrow();
    expect(() => assertSafeRepoPath(root, 'rules/git.md')).not.toThrow();
    expect(() => assertSafeRepoPath(root, 'a/b/c/d.md')).not.toThrow();
  });

  it('rejects parent-directory segments anywhere in the path', () => {
    expect(() => assertSafeRepoPath(root, '..')).toThrow(/parent-directory/);
    expect(() => assertSafeRepoPath(root, '../etc/passwd')).toThrow(/parent-directory/);
    expect(() => assertSafeRepoPath(root, 'rules/../../etc/passwd')).toThrow(/parent-directory/);
    expect(() => assertSafeRepoPath(root, 'rules\\..\\..\\etc\\passwd')).toThrow(/parent-directory/);
  });

  it('rejects POSIX absolute paths', () => {
    expect(() => assertSafeRepoPath(root, '/etc/passwd')).toThrow(/absolute paths/);
  });

  it('rejects Windows drive-letter paths', () => {
    expect(() => assertSafeRepoPath(root, 'C:/Windows/System32')).toThrow(/absolute paths/);
    expect(() => assertSafeRepoPath(root, 'D:\\foo\\bar')).toThrow(/absolute paths/);
  });

  it('rejects empty input', () => {
    expect(() => assertSafeRepoPath(root, '')).toThrow(/empty/);
  });
});
