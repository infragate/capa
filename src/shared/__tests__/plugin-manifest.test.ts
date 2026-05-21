import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectAndParseManifest,
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

  describe('detectAndParseManifest mcpServers resolution', () => {
    it('resolves Cursor mcpServers paths relative to the manifest directory (slack-mcp-plugin layout)', () => {
      // .cursor-plugin/plugin.json declares "mcpServers": "../.cursor-mcp.json".
      // The referenced file lives at repo root, one level above the manifest.
      mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.cursor-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'slack',
          mcpServers: '../.cursor-mcp.json',
        }),
      );
      writeFileSync(
        join(root, '.cursor-mcp.json'),
        JSON.stringify({
          mcpServers: {
            slack: { type: 'http', url: 'https://mcp.slack.com/mcp' },
          },
        }),
      );

      const manifest = detectAndParseManifest(root, ['cursor']);
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.mcpServers)).toEqual(['slack']);
      expect(manifest!.mcpServers.slack.url).toBe('https://mcp.slack.com/mcp');
    });

    it('falls back to .mcp.json at repo root when the chosen manifest declares none', () => {
      // .claude-plugin/plugin.json has no mcpServers — capa should still
      // discover the servers declared in `.mcp.json` at the repo root.
      mkdirSync(join(root, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'slack' }),
      );
      writeFileSync(
        join(root, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            slack: { type: 'http', url: 'https://mcp.slack.com/mcp' },
          },
        }),
      );

      const manifest = detectAndParseManifest(root, ['claude-code']);
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.mcpServers)).toEqual(['slack']);
    });

    it('rejects mcpServers paths that escape the repo root', () => {
      mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.cursor-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'evil',
          mcpServers: '../../../../etc/hosts',
        }),
      );

      const manifest = detectAndParseManifest(root, ['cursor']);
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.mcpServers)).toEqual([]);
    });
  });

  describe('detectAndParseManifest oauth2 client_id normalization', () => {
    it('normalizes Cursor "auth.CLIENT_ID" (uppercase) to client_id', () => {
      // Real-world layout from slackapi/slack-mcp-plugin's .cursor-mcp.json
      mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.cursor-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'slack',
          mcpServers: '../.cursor-mcp.json',
        }),
      );
      writeFileSync(
        join(root, '.cursor-mcp.json'),
        JSON.stringify({
          mcpServers: {
            slack: {
              url: 'https://mcp.slack.com/mcp',
              auth: { CLIENT_ID: '3660753192626.8903469228982' },
            },
          },
        }),
      );

      const manifest = detectAndParseManifest(root, ['cursor']);
      expect(manifest).not.toBeNull();
      const slack = manifest!.mcpServers.slack as {
        oauth2?: Record<string, unknown>;
      };
      expect(slack.oauth2?.client_id).toBe('3660753192626.8903469228982');
    });

    it('normalizes Claude-style "oauth.clientId" (camelCase) and "callbackPort"', () => {
      // Real-world layout from slackapi/slack-mcp-plugin's .mcp.json
      mkdirSync(join(root, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'slack' }),
      );
      writeFileSync(
        join(root, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            slack: {
              url: 'https://mcp.slack.com/mcp',
              oauth: {
                clientId: '1601185624273.8899143856786',
                callbackPort: 3118,
              },
            },
          },
        }),
      );

      const manifest = detectAndParseManifest(root, ['claude-code']);
      expect(manifest).not.toBeNull();
      const slack = manifest!.mcpServers.slack as {
        oauth2?: Record<string, unknown>;
      };
      expect(slack.oauth2?.client_id).toBe('1601185624273.8899143856786');
      expect(slack.oauth2?.callback_port).toBe(3118);
    });

    it('leaves spec-compliant client_id untouched', () => {
      mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
      writeFileSync(
        join(root, '.cursor-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'spec',
          mcpServers: {
            spec: {
              url: 'https://example.com/mcp',
              oauth2: { client_id: 'already-canonical' },
            },
          },
        }),
      );

      const manifest = detectAndParseManifest(root, ['cursor']);
      expect(manifest).not.toBeNull();
      const spec = manifest!.mcpServers.spec as {
        oauth2?: Record<string, unknown>;
      };
      expect(spec.oauth2?.client_id).toBe('already-canonical');
    });
  });
});
