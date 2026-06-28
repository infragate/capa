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

  describe('connectWithTimeout', () => {
    // Capture unhandled rejections during each test so we can assert the
    // timeout path never leaks one (the bug behind the stray
    // "MCP connect timed out after 15000ms" the user saw in the UI/logs).
    let unhandled: unknown[];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    beforeEach(() => {
      unhandled = [];
      process.on('unhandledRejection', onUnhandled);
    });

    afterEach(() => {
      process.off('unhandledRejection', onUnhandled);
    });

    function makeProxy(): any {
      return new MCPProxy(makeMockDb(), 'proj-1', '/tmp/project');
    }

    it('rejects with a timeout error and tears down a hung connect', async () => {
      const proxy = makeProxy();
      let closed = false;
      const client = {
        connect: () => new Promise<void>(() => {}), // never resolves
        close: async () => {
          closed = true;
        },
      };
      const transport = { close: async () => {} };

      await expect(proxy.connectWithTimeout(client, transport, 30)).rejects.toThrow(/timed out/);
      expect(closed).toBe(true);
    });

    it('does not leak an unhandled rejection when the connect rejects after the timeout', async () => {
      const proxy = makeProxy();
      let rejectConnect: (e: unknown) => void = () => {};
      const client = {
        connect: () =>
          new Promise<void>((_, reject) => {
            rejectConnect = reject;
          }),
        close: async () => {},
      };
      const transport = { close: async () => {} };

      await expect(proxy.connectWithTimeout(client, transport, 20)).rejects.toThrow(/timed out/);

      // Simulate the real socket closing *after* we already gave up.
      rejectConnect(new Error('The socket connection was closed unexpectedly'));
      await new Promise((r) => setTimeout(r, 20));

      expect(unhandled).toHaveLength(0);
    });

    it('resolves on a successful connect and clears the timer (no late rejection)', async () => {
      const proxy = makeProxy();
      const client = { connect: async () => {}, close: async () => {} };
      const transport = { close: async () => {} };

      await expect(proxy.connectWithTimeout(client, transport, 50)).resolves.toBeUndefined();

      // Wait well past the timeout window to prove the timer was cleared.
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).toHaveLength(0);
    });

    it('propagates a synchronous connect throw without leaking a timer', async () => {
      const proxy = makeProxy();
      const client = {
        connect: () => {
          throw new Error('boom');
        },
        close: async () => {},
      };
      const transport = { close: async () => {} };

      await expect(proxy.connectWithTimeout(client, transport, 30)).rejects.toThrow(/boom/);

      // If the timer had been scheduled before the throw, it would fire here.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toHaveLength(0);
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
