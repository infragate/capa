import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncWrapProviderConfig } from '../provider-config-sync';

describe('syncWrapProviderConfig', () => {
  let realDir: string;
  let wsDir: string;

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-wrap-cfg-real-'));
    wsDir = mkdtempSync(join(tmpdir(), 'capa-wrap-cfg-ws-'));
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  it('merges permissions from real Claude settings into wrap settings', () => {
    mkdirSync(join(realDir, '.claude'), { recursive: true });
    writeFileSync(
      join(realDir, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] },
        env: { KEEP: 'real-only' },
      }) + '\n',
    );
    mkdirSync(join(wsDir, '.claude'), { recursive: true });
    writeFileSync(
      join(wsDir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
      }) + '\n',
    );

    syncWrapProviderConfig(wsDir, realDir, 'claude-code');

    const out = JSON.parse(readFileSync(join(wsDir, '.claude', 'settings.json'), 'utf8'));
    expect(out.permissions).toEqual({
      allow: ['Bash(npm test)'],
      deny: ['Read(.env)'],
    });
    expect(out.hooks).toBeDefined();
    expect(out.env).toBeUndefined();
  });

  it('is a no-op for Claude when real settings lack permissions', () => {
    mkdirSync(join(realDir, '.claude'), { recursive: true });
    writeFileSync(join(realDir, '.claude', 'settings.json'), '{}\n');
    mkdirSync(join(wsDir, '.claude'), { recursive: true });
    writeFileSync(
      join(wsDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { X: 1 } }) + '\n',
    );

    syncWrapProviderConfig(wsDir, realDir, 'claude-code');

    const out = JSON.parse(readFileSync(join(wsDir, '.claude', 'settings.json'), 'utf8'));
    expect(out).toEqual({ hooks: { X: 1 } });
    expect(out.permissions).toBeUndefined();
  });

  it('copies Cursor cli.json into the wrap workspace', () => {
    mkdirSync(join(realDir, '.cursor'), { recursive: true });
    writeFileSync(
      join(realDir, '.cursor', 'cli.json'),
      JSON.stringify({ permissions: { allow: ['Shell(ls)'] } }) + '\n',
    );

    syncWrapProviderConfig(wsDir, realDir, 'cursor');

    expect(existsSync(join(wsDir, '.cursor', 'cli.json'))).toBe(true);
    expect(readFileSync(join(wsDir, '.cursor', 'cli.json'), 'utf8')).toContain('Shell(ls)');
  });

  it('removes stale wrap cli.json when real file is gone', () => {
    mkdirSync(join(wsDir, '.cursor'), { recursive: true });
    writeFileSync(join(wsDir, '.cursor', 'cli.json'), '{}\n');

    syncWrapProviderConfig(wsDir, realDir, 'cursor');

    expect(existsSync(join(wsDir, '.cursor', 'cli.json'))).toBe(false);
  });

  it('ignores unrelated providers', () => {
    mkdirSync(join(realDir, '.cursor'), { recursive: true });
    writeFileSync(join(realDir, '.cursor', 'cli.json'), '{}\n');
    syncWrapProviderConfig(wsDir, realDir, 'codex');
    expect(existsSync(join(wsDir, '.cursor', 'cli.json'))).toBe(false);
  });
});
