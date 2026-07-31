import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildNativeMcpEntry, upsertNativeMcpServer } from '../native-mcp';
import type { McpIntegration } from '../../../types/providers';

const cursorMcp: McpIntegration = {
  configPath: '.cursor/mcp.json',
  format: 'json',
  serversKey: 'mcpServers',
  serverKey: 'capa',
  entryUrlKey: 'url',
  supportsSubAgentEntries: false,
};

const claudeMcp: McpIntegration = {
  configPath: '.mcp.json',
  format: 'json',
  serversKey: 'mcpServers',
  serverKey: 'capa',
  entryUrlKey: 'url',
  entryType: 'http',
  supportsSubAgentEntries: true,
};

describe('buildNativeMcpEntry', () => {
  it('builds URL entry for cursor', () => {
    const entry = buildNativeMcpEntry(cursorMcp, {
      url: 'https://knowledge-mcp.global.api.aws',
    });
    expect(entry).toEqual({ url: 'https://knowledge-mcp.global.api.aws' });
  });

  it('builds URL entry with type for claude-code', () => {
    const entry = buildNativeMcpEntry(claudeMcp, {
      url: 'https://mcp.example.com',
    });
    expect(entry).toEqual({ type: 'http', url: 'https://mcp.example.com' });
  });

  it('builds stdio command entry', () => {
    const entry = buildNativeMcpEntry(cursorMcp, {
      cmd: 'npx',
      args: ['-y', 'owl-mcp@1.0.14', 'serve'],
      env: { FOO: 'bar' },
    });
    expect(entry).toEqual({
      command: 'npx',
      args: ['-y', 'owl-mcp@1.0.14', 'serve'],
      env: { FOO: 'bar' },
    });
  });
});

describe('upsertNativeMcpServer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-native-mcp-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('writes owl stdio server into .cursor/mcp.json', async () => {
    const result = await upsertNativeMcpServer(
      tempDir,
      'owl',
      { cmd: 'npx', args: ['-y', 'owl-mcp@1.0.14', 'serve'] },
      ['cursor'],
    );
    expect(result.written.length).toBe(1);
    expect(result.written[0].serverKey).toBe('owl');
    const configPath = join(tempDir, '.cursor', 'mcp.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.owl).toEqual({
      command: 'npx',
      args: ['-y', 'owl-mcp@1.0.14', 'serve'],
    });
    expect(config.mcpServers.capa).toBeUndefined();
  });

  it('writes remote URL server into .mcp.json for claude-code', async () => {
    await upsertNativeMcpServer(
      tempDir,
      'aws-knowledge',
      { url: 'https://knowledge-mcp.global.api.aws' },
      ['claude-code'],
    );
    const config = JSON.parse(readFileSync(join(tempDir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers['aws-knowledge']).toEqual({
      type: 'http',
      url: 'https://knowledge-mcp.global.api.aws',
    });
  });

  it('refuses reserved capa key', async () => {
    await expect(
      upsertNativeMcpServer(tempDir, 'capa', { url: 'https://x' }, ['cursor']),
    ).rejects.toThrow(/reserved key/);
  });

  it('refuses to overwrite malformed MCP JSON', async () => {
    const configDir = join(tempDir, '.cursor');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    writeFileSync(configPath, '{ not valid json', 'utf-8');

    const result = await upsertNativeMcpServer(
      tempDir,
      'owl',
      { cmd: 'npx', args: ['-y', 'owl-mcp'] },
      ['cursor'],
    );
    expect(result.written.length).toBe(0);
    expect(result.warnings.some((w) => /Failed to parse existing MCP config/.test(w))).toBe(true);
    expect(readFileSync(configPath, 'utf-8')).toBe('{ not valid json');
  });
});
