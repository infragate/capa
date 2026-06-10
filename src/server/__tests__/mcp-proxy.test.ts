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

  describe('OAuth2 disconnected handling', () => {
    function makeOauthServerDef(): MCPServerDefinition {
      return {
        url: 'https://mcp.example.com',
        oauth2: { clientId: 'x', authorizationUrl: 'a', tokenUrl: 't' },
      } as MCPServerDefinition;
    }

    function makeProxyWithDisconnectedOauth(): MCPProxy {
      const proxy = new MCPProxy(makeMockDb(), 'proj-1', '/tmp/project');
      (proxy as any).oauth2Manager = { isServerConnected: () => false };
      return proxy;
    }

    it('listTools throws an auth-specific error (not "could not connect") when throwOnError is true', async () => {
      const proxy = makeProxyWithDisconnectedOauth();
      await expect(
        proxy.listTools('atlassian', makeOauthServerDef(), { throwOnError: true })
      ).rejects.toThrow(/Authentication failed for "atlassian"\. Please reconnect OAuth2/);
    });

    it('listTools returns [] silently when throwOnError is false (default install path)', async () => {
      const proxy = makeProxyWithDisconnectedOauth();
      const result = await proxy.listTools('atlassian', makeOauthServerDef());
      expect(result).toEqual([]);
    });

    it('executeTool returns auth-specific failure (not "failed to connect") when OAuth disconnected', async () => {
      const proxy = makeProxyWithDisconnectedOauth();
      const result = await proxy.executeTool(
        'atlassian.search',
        { server: 'atlassian', tool: 'search' } as any,
        makeOauthServerDef(),
        { query: 'abc' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Authentication failed for "atlassian"\. Please reconnect OAuth2/);
      expect(result.error).not.toMatch(/Failed to connect/);
    });
  });
});
