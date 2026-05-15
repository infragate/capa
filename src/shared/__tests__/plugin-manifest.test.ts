import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  discoverPluginEntries,
  findPluginInDirectory,
} from '../plugin-manifest';

function writeClaudePlugin(root: string, relDir: string, manifestName: string): void {
  const dir = join(root, relDir, '.claude-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: manifestName }));
}

function writeCursorPlugin(root: string, relDir: string, manifestName: string): void {
  const dir = join(root, relDir, '.cursor-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: manifestName }));
}

describe('plugin-manifest discovery', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'capa-plugin-manifest-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('discoverPluginEntries', () => {
    it('finds Claude plugins at the repo root', () => {
      writeClaudePlugin(root, '.', 'root-plugin');
      const entries = discoverPluginEntries(root, ['claude-code']);
      expect(entries.length).toBe(1);
      expect(entries[0].subpath).toBe('');
      expect(entries[0].manifestName).toBe('root-plugin');
    });

    it('finds Claude plugins in nested subdirectories', () => {
      writeClaudePlugin(root, 'plugins/code-review', 'code-review');
      writeClaudePlugin(root, 'plugins/debugger', 'debugger');
      const entries = discoverPluginEntries(root, ['claude-code']);
      const subpaths = entries.map((e) => e.subpath).sort();
      expect(subpaths).toEqual(['plugins/code-review', 'plugins/debugger']);
    });

    it('finds Cursor plugins when Cursor is a preferred provider', () => {
      writeCursorPlugin(root, 'extensions/my-plugin', 'my-plugin');
      const entries = discoverPluginEntries(root, ['cursor']);
      expect(entries.length).toBe(1);
      expect(entries[0].subpath).toBe('extensions/my-plugin');
    });

    it('skips node_modules, .git, and build output dirs', () => {
      writeClaudePlugin(root, 'plugins/real', 'real');
      writeClaudePlugin(root, 'node_modules/skipped', 'skipped');
      writeClaudePlugin(root, '.git/skipped', 'skipped');
      writeClaudePlugin(root, 'dist/skipped', 'skipped');
      const entries = discoverPluginEntries(root, ['claude-code']);
      expect(entries.map((e) => e.subpath).sort()).toEqual(['plugins/real']);
    });
  });

  describe('findPluginInDirectory', () => {
    it('matches by directory basename', () => {
      writeClaudePlugin(root, 'plugins/code-review', 'code-review');
      const located = findPluginInDirectory(root, 'code-review', ['claude-code']);
      expect(located).not.toBeNull();
      expect(located!.entry.subpath).toBe('plugins/code-review');
    });

    it('matches by manifest "name" field when basename differs', () => {
      writeClaudePlugin(root, 'tools/cr', 'code-review');
      const located = findPluginInDirectory(root, 'code-review', ['claude-code']);
      expect(located).not.toBeNull();
      expect(located!.entry.subpath).toBe('tools/cr');
      expect(located!.entry.manifestName).toBe('code-review');
    });

    it('returns null when no plugin matches', () => {
      writeClaudePlugin(root, 'plugins/other', 'other');
      const located = findPluginInDirectory(root, 'code-review', ['claude-code']);
      expect(located).toBeNull();
    });

    it('prefers directory basename over manifest name when both exist', () => {
      // Two plugins: one whose dirname is "shared", one whose manifest.name is "shared".
      writeClaudePlugin(root, 'a/shared', 'a-plugin');
      writeClaudePlugin(root, 'b/something-else', 'shared');
      const located = findPluginInDirectory(root, 'shared', ['claude-code']);
      expect(located).not.toBeNull();
      expect(located!.entry.subpath).toBe('a/shared');
    });

    it('discovers Cursor plugins identically', () => {
      writeCursorPlugin(root, 'cursor-plugins/code-review', 'code-review');
      const located = findPluginInDirectory(root, 'code-review', ['cursor']);
      expect(located).not.toBeNull();
      expect(located!.entry.subpath).toBe('cursor-plugins/code-review');
    });
  });
});
