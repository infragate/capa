import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { CapaDatabase } from '../../../../../db/database';
import { LockfileBuilder } from '../../../../../shared/lockfile';
import { installOneSkill, looksLikeHtml } from '../install-one-skill';
import { getCacheStats } from '../../../../../shared/cache';
import * as repoSnapshot from '../repo-snapshot';
import type { Capabilities, Skill } from '../../../../../types/capabilities';

// A skill on "any git host": a real repository cloned over file://, so the
// whole path (clone, tag resolution, snapshot, copy, lock entry) runs for real.
describe('installOneSkill with a git clone URL', () => {
  let tempDir: string;
  let projectPath: string;
  let repoUrl: string;
  let db: CapaDatabase;
  const prevCacheDir = process.env.CAPA_CACHE_DIR;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-git-skill-'));
    process.env.CAPA_CACHE_DIR = join(tempDir, 'cache');
    projectPath = join(tempDir, 'project');
    mkdirSync(projectPath, { recursive: true });

    const repo = join(tempDir, 'work');
    mkdirSync(join(repo, 'nested', 'lint'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'capa-test@example.com');
    git(repo, 'config', 'user.name', 'capa-test');
    writeFileSync(join(repo, 'SKILL.md'), '---\nname: code-review\ndescription: v1\n---\n\nFirst.\n');
    writeFileSync(join(repo, 'nested', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: lint\n---\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'tag', 'v1.0.0');
    writeFileSync(join(repo, 'SKILL.md'), '---\nname: code-review\ndescription: unreleased\n---\n\nSecond.\n');
    git(repo, 'commit', '-q', '-am', 'second');
    // Served like a real host: a bare repository whose name ends in .git.
    const bare = join(tempDir, '@acme', 'code-review.git');
    mkdirSync(join(tempDir, '@acme'));
    git(tempDir, 'clone', '-q', '--bare', repo, bare);
    repoUrl = pathToFileURL(bare).href;

    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: 'proj', path: projectPath });
  });

  afterEach(() => {
    db.close();
    if (prevCacheDir === undefined) delete process.env.CAPA_CACHE_DIR;
    else process.env.CAPA_CACHE_DIR = prevCacheDir;
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function install(skill: Skill, lockBuilder = new LockfileBuilder()) {
    const capabilities: Capabilities = { providers: ['cursor'], skills: [skill], servers: [], tools: [] };
    await installOneSkill(
      skill,
      projectPath,
      'proj',
      ['cursor'],
      db,
      { server: { host: '127.0.0.1', port: 5912 } },
      capabilities,
      join(projectPath, 'capabilities.yaml'),
      lockBuilder,
      false,
      new Map(),
    );
    return lockBuilder.build();
  }

  it('installs the root SKILL.md at the latest version tag and locks the URL', async () => {
    const lock = await install({ id: 'code-review', type: 'git', def: { url: repoUrl } });

    const installed = readFileSync(join(projectPath, '.cursor', 'skills', 'code-review', 'SKILL.md'), 'utf8');
    expect(installed).toContain('description: v1');
    expect(lock.skills[0]).toMatchObject({
      id: 'code-review',
      source: 'git',
      url: repoUrl,
      resolvedVersion: 'v1.0.0',
    });
  });

  it('keeps credentials in the URL out of the lock entry and the clone', async () => {
    const real = repoSnapshot.getRepoSnapshot;
    const seen: (string | undefined)[] = [];
    // No real host in tests: record the URL capa clones, then serve the local repo.
    const spy = spyOn(repoSnapshot, 'getRepoSnapshot').mockImplementation((platform, repoPath, auth, opts = {}) => {
      seen.push(opts.repoUrl);
      return real(platform, repoPath, auth, { ...opts, repoUrl });
    });
    try {
      const lock = await install({
        id: 'code-review',
        type: 'git',
        def: { url: 'https://user:s3cret@git.example.com/acme/code-review.git' },
      });
      expect(lock.skills[0].url).toBe('https://git.example.com/acme/code-review.git');
      expect(JSON.stringify(lock)).not.toContain('s3cret');
      expect(seen).toEqual(['https://git.example.com/acme/code-review.git']);
    } finally {
      spy.mockRestore();
    }
  });

  it('installs a nested skill from def.path', async () => {
    await install({ id: 'lint', type: 'git', def: { url: repoUrl, path: 'nested/lint' } });
    expect(readFileSync(join(projectPath, '.cursor', 'skills', 'lint', 'SKILL.md'), 'utf8')).toContain('name: lint');
  });

  it('names the skills it found when SKILL.md is missing, and leaves no lock pin', async () => {
    const lockBuilder = new LockfileBuilder();
    await expect(
      install({ id: 'x', type: 'git', def: { url: repoUrl, path: 'nested' } }, lockBuilder),
    ).rejects.toThrow(/nested\/lint/);
    expect(lockBuilder.build().skills).toEqual([]);
  });

  it('reports a missing tag as a missing tag, not a missing repository', async () => {
    await expect(
      install({ id: 'code-review', type: 'git', def: { url: repoUrl, version: 'v9.9.9' } }),
    ).rejects.toThrow(/Tag\/branch "v9\.9\.9" not found/);
  });

  it('shows git repositories in cache stats', async () => {
    await install({ id: 'code-review', type: 'git', def: { url: repoUrl } });
    const repos = getCacheStats().repos.filter((r) => r.platform === 'git');
    expect(repos).toHaveLength(1);
    expect(repos[0].repoPath).toMatch(/^file\/code-review-[0-9a-f]{12}$/);
    expect(repos[0].snapshotCount).toBe(1);
  });
});

describe('looksLikeHtml', () => {
  it('catches ordinary web pages, with or without leading whitespace', () => {
    expect(looksLikeHtml('<!DOCTYPE html>\n<html lang="en">')).toBe(true);
    expect(looksLikeHtml('  \n<html lang="en"><head>')).toBe(true);
    expect(looksLikeHtml('---\nname: x\n---\n<html> in a code sample')).toBe(false);
    expect(looksLikeHtml('# Skill\n')).toBe(false);
  });
});
