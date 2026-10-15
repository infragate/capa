import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureStablePluginCopy, PLUGIN_STAMP_FILE } from '../plugin-install';
import { detectAndParseManifest } from '../../../shared/plugin-manifest';

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
  it('resolves a plugin whose skills link into the rest of the repo (#312)', () => {
    // gitlab-org/ai/skills: .claude-plugin/plugins/glab/skills/glab -> skills/glab,
    // next to a root plugin.json that is not an Agent Plugins manifest.
    const repo = src('repo', {
      'skills/glab/SKILL.md': '# glab',
      '.claude-plugin/plugins/glab/plugin.json': '{"name":"glab","skills":"./"}',
    });
    const plugin = join(repo, '.claude-plugin', 'plugins', 'glab');
    mkdirSync(join(plugin, 'skills'));
    symlinkSync(join(repo, 'skills', 'glab'), join(plugin, 'skills', 'glab'), 'junction');

    const manifest = detectAndParseManifest(plugin, ['claude-code']);
    expect(manifest?.skillEntries.map((s) => s.id)).toEqual(['glab']);

    const dest = join(dir, 'plugins', 'glab');
    ensureStablePluginCopy(plugin, dest, 'sha1', repo);
    expect(lstatSync(join(dest, 'skills', 'glab')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dest, 'skills', 'glab', 'SKILL.md'), 'utf8')).toBe('# glab');
  });
});
