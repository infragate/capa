import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  registerSubAgentMCPServer,
  unregisterSubAgentMCPServer,
  registerMCPServer,
} from '../mcp-client-manager';

describe('sub-agent MCP client registration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-subagent-mcp-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  const readConfig = (file: string) => JSON.parse(readFileSync(file, 'utf-8'));

  it('registers sub-agent with key capa-{id} in claude-code config', async () => {
    await registerSubAgentMCPServer(
      tempDir,
      'infra-agent',
      'http://localhost:5912/proj-1/agents/infra-agent/mcp',
      ['claude-code']
    );

    const config = readConfig(join(tempDir, '.mcp.json'));
    expect(config.mcpServers['capa-infra-agent']).toEqual({
      type: 'http',
      url: 'http://localhost:5912/proj-1/agents/infra-agent/mcp',
    });
    expect(config.mcpServers['capa']).toBeUndefined();
  });

  it('skips cursor provider — sub-agent MCP entries are not used by Cursor', async () => {
    await registerSubAgentMCPServer(
      tempDir,
      'api-agent',
      'http://localhost:5912/proj-1/agents/api-agent/mcp',
      ['cursor']
    );

    // Cursor does not register per-sub-agent MCP entries
    expect(existsSync(join(tempDir, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('main and sub-agent entries coexist in the same config file', async () => {
    await registerMCPServer(
      tempDir,
      'proj-1',
      'http://localhost:5912/proj-1/mcp',
      ['claude-code']
    );
    await registerSubAgentMCPServer(
      tempDir,
      'infra-agent',
      'http://localhost:5912/proj-1/agents/infra-agent/mcp',
      ['claude-code']
    );
    await registerSubAgentMCPServer(
      tempDir,
      'api-agent',
      'http://localhost:5912/proj-1/agents/api-agent/mcp',
      ['claude-code']
    );

    const config = readConfig(join(tempDir, '.mcp.json'));
    expect(Object.keys(config.mcpServers).sort()).toEqual([
      'capa',
      'capa-api-agent',
      'capa-infra-agent',
    ]);
  });

  it('unregisters only the sub-agent key, leaving main entry intact', async () => {
    await registerMCPServer(tempDir, 'proj-1', 'http://localhost:5912/proj-1/mcp', ['claude-code']);
    await registerSubAgentMCPServer(
      tempDir,
      'infra-agent',
      'http://localhost:5912/proj-1/agents/infra-agent/mcp',
      ['claude-code']
    );

    await unregisterSubAgentMCPServer(tempDir, 'infra-agent', ['claude-code']);

    const config = readConfig(join(tempDir, '.mcp.json'));
    expect(config.mcpServers['capa-infra-agent']).toBeUndefined();
    expect(config.mcpServers['capa']).toBeDefined();
  });

  it('unregisterSubAgentMCPServer is a no-op when config does not exist', async () => {
    // Should not throw
    await unregisterSubAgentMCPServer(tempDir, 'ghost-agent', ['claude-code']);
    expect(existsSync(join(tempDir, '.mcp.json'))).toBe(false);
  });

  it('registers sub-agent MCP only for claude-code when both providers given', async () => {
    await registerSubAgentMCPServer(
      tempDir,
      'infra-agent',
      'http://localhost:5912/proj-1/agents/infra-agent/mcp',
      ['claude-code', 'cursor']
    );

    // claude-code gets the MCP entry; cursor does not
    const claudeConfig = readConfig(join(tempDir, '.mcp.json'));
    expect(claudeConfig.mcpServers['capa-infra-agent']).toBeDefined();
    expect(existsSync(join(tempDir, '.cursor', 'mcp.json'))).toBe(false);
  });
});
