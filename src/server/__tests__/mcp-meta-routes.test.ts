import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { resetSecretCryptoForTests } from '../../shared/secret-crypto';
import { isStdioTrusted } from '../../shared/stdio-allowlist';
import { handleSetServerEnabled } from '../../server/mcp-meta-routes';
import { McpServerStateManager } from '../../server/mcp-server-state';
import type { CapaMCPServer } from '../../server/mcp-handler';
import type { Capabilities } from '../../types/capabilities';

function removeTempDirWithRetry(dir: string, attempts = 8): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
        throw error;
      }
      if (i === attempts - 1) return;
      Bun.sleepSync(50 * (i + 1));
    }
  }
}

describe('handleSetServerEnabled stdio allowlist', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;
  const projectId = 'proj-stdio';
  const serverId = 'my-stdio';
  const capabilities: Capabilities = {
    providers: [],
    options: {},
    skills: [],
    tools: [],
    servers: [
      {
        id: serverId,
        type: 'mcp',
        def: { cmd: 'node', args: ['server.js'] },
      },
    ],
    subagents: [],
    hooks: [],
    plugins: [],
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-stdio-enable-'));
    prevHome = process.env.HOME;
    prevProfile = process.env.USERPROFILE;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    resetSecretCryptoForTests();
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: projectId, path: tempDir });
  });

  afterEach(() => {
    db.close();
    resetSecretCryptoForTests();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    removeTempDirWithRetry(tempDir);
  });

  it('trusts stdio launch before connecting when enabling from the UI', async () => {
    const mcpServerState = new McpServerStateManager();
    const sessionManager = {
      getProjectCapabilities: () => capabilities,
    };
    const mcpServer: Pick<CapaMCPServer, 'listServerTools' | 'disconnectNonEnabledServers'> = {
      listServerTools: async () => [{ name: 'tool-a' }],
      disconnectNonEnabledServers: async () => {},
    };

    expect(isStdioTrusted(projectId, capabilities.servers[0]!.def)).toBe(false);

    const response = await handleSetServerEnabled(
      {
        db,
        sessionManager: sessionManager as any,
        getOrCreateMCPServer: () => mcpServer as CapaMCPServer,
        mcpServerState,
      },
      projectId,
      serverId,
      new Request('http://local/enabled', {
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mcpServerState.isEnabled(projectId, serverId)).toBe(true);
    expect(isStdioTrusted(projectId, capabilities.servers[0]!.def)).toBe(true);
  });
});
