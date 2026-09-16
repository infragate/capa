import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureStablePluginCopy, PLUGIN_STAMP_FILE } from '../plugin-install';

describe('ensureStablePluginCopy', () => {
  let dir: string;
  const src = (name: string, files: Record<string, string>) => {
    const root = join(dir, name);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-stable-'));
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('copies the tree and records the source stamp', () => {
    const from = src('v1', { 'skills/a/SKILL.md': 'A', 'README.md': 'r' });
    const dest = join(dir, 'plugins', 'atlassian');
    ensureStablePluginCopy(from, dest, 'sha1');
    expect(readFileSync(join(dest, 'skills/a/SKILL.md'), 'utf8')).toBe('A');
    expect(readFileSync(join(dest, PLUGIN_STAMP_FILE), 'utf8')).toBe('sha1');
  });

  it('leaves a copy from the same source untouched (no delete while others read it)', () => {
    const from = src('v1', { 'skills/a/SKILL.md': 'A' });
    const dest = join(dir, 'plugins', 'atlassian');
    ensureStablePluginCopy(from, dest, 'sha1');
    // A reader-visible marker that a re-copy would wipe out.
    writeFileSync(join(dest, 'in-use.txt'), 'x');
    ensureStablePluginCopy(from, dest, 'sha1');
    expect(existsSync(join(dest, 'in-use.txt'))).toBe(true);
  });

  it('swaps in a new source and leaves no staging or old dirs behind', () => {
    const dest = join(dir, 'plugins', 'atlassian');
    ensureStablePluginCopy(src('v1', { 'skills/a/SKILL.md': 'A' }), dest, 'sha1');
    ensureStablePluginCopy(src('v2', { 'skills/b/SKILL.md': 'B' }), dest, 'sha2');
    expect(existsSync(join(dest, 'skills/a'))).toBe(false);
    expect(readFileSync(join(dest, 'skills/b/SKILL.md'), 'utf8')).toBe('B');
    expect(readdirSync(join(dir, 'plugins'))).toEqual(['atlassian']);
  });

  it('replaces a legacy copy that has no stamp', () => {
    const dest = join(dir, 'plugins', 'atlassian');
    mkdirSync(join(dest, 'partial'), { recursive: true });
    ensureStablePluginCopy(src('v1', { 'skills/a/SKILL.md': 'A' }), dest, 'sha1');
    expect(existsSync(join(dest, 'partial'))).toBe(false);
    expect(existsSync(join(dest, 'skills/a/SKILL.md'))).toBe(true);
  });
});
