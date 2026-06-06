import { describe, it, expect } from 'bun:test';
import { resolve } from 'path';
import { resolvePluginServerDef, normalizeMcpServerEntry } from '../mcp-parser';

const PLUGIN_ROOT = '/abs/plugins/aws-dev-toolkit';

describe('resolvePluginServerDef', () => {
  it('leaves a bare executable command and its flags/specs untouched (#94)', () => {
    // A typical command-based MCP server: `uvx -y awslabs.some-mcp-server`.
    const resolved = resolvePluginServerDef(
      { cmd: 'uvx', args: ['-y', 'awslabs.some-mcp-server'] },
      PLUGIN_ROOT
    );
    expect(resolved.cmd).toBe('uvx');
    expect(resolved.args).toEqual(['-y', 'awslabs.some-mcp-server']);
  });

  it('leaves npx package specs untouched', () => {
    const resolved = resolvePluginServerDef(
      { cmd: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      PLUGIN_ROOT
    );
    expect(resolved.cmd).toBe('npx');
    expect(resolved.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
  });

  it('expands ${CLAUDE_PLUGIN_ROOT} in cmd and args', () => {
    const resolved = resolvePluginServerDef(
      {
        cmd: 'python',
        args: ['${CLAUDE_PLUGIN_ROOT}/server.py'],
        env: { DATA_DIR: '${CLAUDE_PLUGIN_ROOT}/data' },
      },
      PLUGIN_ROOT
    );
    expect(resolved.cmd).toBe('python');
    expect(resolved.args).toEqual([`${PLUGIN_ROOT}/server.py`]);
    expect(resolved.env).toEqual({ DATA_DIR: `${PLUGIN_ROOT}/data` });
  });

  it('resolves explicit relative path commands against the plugin root', () => {
    const resolved = resolvePluginServerDef(
      { cmd: './bin/server', args: ['./config.json'] },
      PLUGIN_ROOT
    );
    expect(resolved.cmd).toBe(resolve(PLUGIN_ROOT, './bin/server'));
    expect(resolved.args).toEqual([resolve(PLUGIN_ROOT, './config.json')]);
  });

  it('passes remote (url) servers through unchanged', () => {
    const resolved = resolvePluginServerDef(
      { url: 'https://mcp.example.com', headers: { 'X-Key': 'v' } },
      PLUGIN_ROOT
    );
    expect(resolved.url).toBe('https://mcp.example.com');
    expect(resolved.headers).toEqual({ 'X-Key': 'v' });
    expect(resolved.cmd).toBeUndefined();
  });
});

describe('normalizeMcpServerEntry', () => {
  it('accepts the `command` spelling and maps it to cmd', () => {
    const normalized = normalizeMcpServerEntry({ command: 'uvx', args: ['x'] });
    expect(normalized).toEqual({ cmd: 'uvx', args: ['x'], env: undefined });
  });

  it('accepts the `cmd` spelling', () => {
    const normalized = normalizeMcpServerEntry({ cmd: 'npx', args: ['-y', 'pkg'] });
    expect(normalized).toEqual({ cmd: 'npx', args: ['-y', 'pkg'], env: undefined });
  });
});
