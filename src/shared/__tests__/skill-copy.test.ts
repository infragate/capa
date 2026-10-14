import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { copySkillTree, forEachSkillFile } from '../skill-copy';

describe('copySkillTree', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'capa-skill-copy-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('copies a simple flat directory', () => {
    const src = join(workDir, 'src-flat');
    const dst = join(workDir, 'dst-flat');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), '# Skill');
    writeFileSync(join(src, 'notes.txt'), 'hello');

    const { filesCopied } = copySkillTree({ src, dst });

    expect(filesCopied).toBe(2);
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf-8')).toBe('# Skill');
    expect(readFileSync(join(dst, 'notes.txt'), 'utf-8')).toBe('hello');
  });

  it('copies a nested directory', () => {
    const src = join(workDir, 'src-nested');
    const dst = join(workDir, 'dst-nested');
    mkdirSync(join(src, 'scripts'), { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), '# Nested');
    writeFileSync(join(src, 'scripts', 'run.sh'), '#!/bin/sh');

    copySkillTree({ src, dst });

    expect(readFileSync(join(dst, 'scripts', 'run.sh'), 'utf-8')).toBe('#!/bin/sh');
  });

  it('rejects a symlink that escapes the source dir', () => {
    const src = join(workDir, 'src-escape');
    const dst = join(workDir, 'dst-escape');
    const outside = join(workDir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    mkdirSync(join(src, 'nested'), { recursive: true });

    try {
      symlinkSync(join('..', '..', 'outside', 'secret.txt'), join(src, 'nested', 'link.txt'), 'file');
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'ENOSYS') {
        return;
      }
      throw err;
    }

    expect(() => copySkillTree({ src, dst })).toThrow(/outside the source directory/);
  });

  it('copies a symlinked dir that resolves inside root (#312)', () => {
    // GitLab layout: .claude-plugin/plugins/glab/skills/glab -> skills/glab
    const repo = join(workDir, 'repo');
    const plugin = join(repo, '.claude-plugin', 'plugins', 'glab');
    const dst = join(workDir, 'dst-link');
    mkdirSync(join(repo, 'skills', 'glab'), { recursive: true });
    writeFileSync(join(repo, 'skills', 'glab', 'SKILL.md'), '# glab');
    mkdirSync(join(plugin, 'skills'), { recursive: true });
    // Junctions need no symlink privilege on Windows; the type is ignored elsewhere.
    symlinkSync(join(repo, 'skills', 'glab'), join(plugin, 'skills', 'glab'), 'junction');
    // A link back to an ancestor must not recurse forever.
    symlinkSync(join(repo, 'skills'), join(repo, 'skills', 'glab', 'loop'), 'junction');

    expect(() => copySkillTree({ src: plugin, dst })).toThrow(/outside the source directory/);

    copySkillTree({ src: plugin, dst, root: repo });
    expect(readFileSync(join(dst, 'skills', 'glab', 'SKILL.md'), 'utf-8')).toBe('# glab');
    // The loop link points at a directory already being copied: skipped.
    expect(existsSync(join(dst, 'skills', 'glab', 'loop', 'glab'))).toBe(false);
  });

  it('copies each linked directory once, so link fan-out stays linear', () => {
    // d0/{a,b} -> d1, d1/{a,b} -> d2, ... used to copy 2^N trees.
    const src = join(workDir, 'fan');
    const dst = join(workDir, 'dst-fan');
    const depth = 12;
    for (let i = 0; i <= depth; i++) mkdirSync(join(src, `d${i}`), { recursive: true });
    writeFileSync(join(src, `d${depth}`, 'leaf.txt'), 'x');
    for (let i = 0; i < depth; i++) {
      for (const name of ['a', 'b']) {
        symlinkSync(join(src, `d${i + 1}`), join(src, `d${i}`, name), 'junction');
      }
    }
    const skipped: string[] = [];
    const { filesCopied } = copySkillTree({
      src: join(src, 'd0'),
      dst,
      root: src,
      onSkippedLink: (rel) => skipped.push(rel),
    });
    expect(filesCopied).toBe(1);
    expect(skipped.length).toBe(depth);
  });

  it('skips broken and escaping links when onSkippedLink is set', () => {
    const repo = join(workDir, 'repo-skip');
    const outside = join(workDir, 'outside-skip');
    const dst = join(workDir, 'dst-skip');
    mkdirSync(join(repo, 'plugin'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(repo, 'plugin', 'SKILL.md'), '# ok');
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(repo, 'plugin', 'escape'), 'junction');
    symlinkSync(join(repo, 'missing'), join(repo, 'plugin', 'dangling'), 'junction');

    const skipped: Record<string, string> = {};
    copySkillTree({
      src: join(repo, 'plugin'),
      dst,
      root: repo,
      onSkippedLink: (rel, reason) => (skipped[rel] = reason),
    });
    expect(readFileSync(join(dst, 'SKILL.md'), 'utf-8')).toBe('# ok');
    expect(existsSync(join(dst, 'escape'))).toBe(false);
    expect(skipped).toEqual({ escape: 'points outside the repository', dangling: 'broken link' });
    // Without the callback an escaping link still fails the copy.
    expect(() => copySkillTree({ src: join(repo, 'plugin'), dst: `${dst}2`, root: repo })).toThrow();
  });

  it('honours maxFileBytes (rejects files larger than the limit)', () => {
    const src = join(workDir, 'src-limit');
    const dst = join(workDir, 'dst-limit');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'big.bin'), Buffer.alloc(128));

    expect(() =>
      copySkillTree({ src, dst, maxFileBytes: 64 })
    ).toThrow(/exceeds the maximum allowed size/);
  });

  it('calls onFile callback for each file', () => {
    const src = join(workDir, 'src-cb');
    const dst = join(workDir, 'dst-cb');
    mkdirSync(join(src, 'nested'), { recursive: true });
    writeFileSync(join(src, 'a.txt'), 'a');
    writeFileSync(join(src, 'nested', 'b.txt'), 'b');

    const seen: string[] = [];
    copySkillTree({
      src,
      dst,
      onFile: (relPath) => seen.push(relPath.replace(/\\/g, '/')),
    });

    expect(seen.sort()).toEqual(['a.txt', 'nested/b.txt']);
  });
});

describe('forEachSkillFile', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'capa-skill-walk-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('visits each file with symlink protection', () => {
    const src = join(workDir, 'src-walk');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'one.txt'), '1');
    writeFileSync(join(src, 'two.txt'), '2');

    const paths: string[] = [];
    forEachSkillFile(src, ({ relPath }) => paths.push(relPath.replace(/\\/g, '/')));

    expect(paths.sort()).toEqual(['one.txt', 'two.txt']);
    expect(existsSync(join(src, 'one.txt'))).toBe(true);
    expect(statSync(join(src, 'one.txt')).isFile()).toBe(true);
  });
});
