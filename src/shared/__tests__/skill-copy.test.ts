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
