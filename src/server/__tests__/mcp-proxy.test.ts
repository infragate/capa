import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MCPProxy } from '../mcp-proxy';
import { shouldSkipTlsVerify } from '../../shared/tls-skip-verify';
import type { CapaDatabase } from '../../db/database';
import type { MCPServerDefinition } from '../../types/capabilities';

function makeMockDb(): CapaDatabase {
  return {
    getVariable: () => 'resolved-value',
  } as unknown as CapaDatabase;
}

describe('mcp-proxy', () => {
  let originalTlsEnv: string | undefined;

  beforeEach(() => {
    originalTlsEnv = process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
  });

  afterEach(() => {
    if (originalTlsEnv === undefined) {
      delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    } else {
      process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = originalTlsEnv;
    }
  });

  it('loads and exports MCPProxy', () => {
    expect(MCPProxy).toBeDefined();
    expect(typeof MCPProxy).toBe('function');
  });

  it('constructs without throwing', () => {
    expect(() => new MCPProxy(makeMockDb(), 'proj-1', '/tmp/project')).not.toThrow();
  });

  it('routes stdio servers (cmd) vs http servers (url) via getOrCreateClient', async () => {
    const proxy = new MCPProxy(makeMockDb(), 'proj-1', '/tmp/project');
    const routes: Array<'stdio' | 'http'> = [];

    (proxy as any).getOrCreateClient = async (
      _serverId: string,
      serverDefinition: MCPServerDefinition,
    ) => {
      if (serverDefinition.cmd) routes.push('stdio');
      else if (serverDefinition.url) routes.push('http');
      return null;
    };

    await proxy.listTools('stdio-server', { cmd: 'node', args: ['server.js'] });
    await proxy.listTools('http-server', { url: 'https://mcp.example.com' });

    expect(routes).toEqual(['stdio', 'http']);
  });

  it('strips @ prefix from server id before connecting', async () => {
    const proxy = new MCPProxy(makeMockDb(), 'proj-1', '/tmp/project');
    let seenServerId: string | undefined;

    (proxy as any).getOrCreateClient = async (serverId: string) => {
      seenServerId = serverId;
      return null;
    };

    await proxy.listTools('@my-server', { url: 'https://mcp.example.com' });
    expect(seenServerId).toBe('my-server');
  });

  describe('tlsSkipVerify wiring', () => {
    it('returns false when env is unset even if server config requests skip', () => {
      expect(shouldSkipTlsVerify(true, 'MCP HTTP transport (test-server)')).toBe(false);
    });

    it('honors skip when env and config both allow it', () => {
      process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = '1';
      expect(shouldSkipTlsVerify(true, 'MCP HTTP transport (test-server)')).toBe(true);
    });
  });
});
