import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as config from '../config';
import {
  isStdioTrusted,
  stdioLaunchFingerprint,
  trustStdioServers,
} from '../stdio-allowlist';
import type { MCPServer } from '../../types/capabilities';

function stdioServer(id: string, cmd: string, args: string[] = []): MCPServer {
  return {
    id,
    type: 'mcp',
    def: { cmd, args },
  };
}

describe('stdio-allowlist', () => {
  let capaDir: string;
  let dirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    capaDir = mkdtempSync(join(tmpdir(), 'capa-stdio-allowlist-'));
    dirSpy = spyOn(config, 'getCapaDir').mockReturnValue(capaDir);
  });

  afterEach(() => {
    dirSpy.mockRestore();
    rmSync(capaDir, { recursive: true, force: true });
  });

  it('fingerprints cmd, args, cwd, and env', () => {
    const a = stdioLaunchFingerprint({ cmd: 'node', args: ['a.js'], cwd: '/tmp', env: { B: '1', A: '2' } });
    const b = stdioLaunchFingerprint({ cmd: 'node', args: ['a.js'], cwd: '/tmp', env: { A: '2', B: '1' } });
    const c = stdioLaunchFingerprint({ cmd: 'node', args: ['b.js'], cwd: '/tmp' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // Hashed — never persists cleartext env in the fingerprint string itself.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprints secret pointers without resolved values', () => {
    const authored = stdioLaunchFingerprint({
      cmd: 'node',
      args: ['a.js'],
      env: { TOKEN: { fromEnv: 'MY_TOKEN' } },
    });
    const resolved = stdioLaunchFingerprint({
      cmd: 'node',
      args: ['a.js'],
      env: { TOKEN: 'super-secret-value' },
    });
    expect(authored).not.toBe(resolved);
  });

  it('does not trust stdio servers until CLI records them', () => {
    const server = stdioServer('evil', 'touch', ['/tmp/pwned']);
    expect(isStdioTrusted('proj-1', server.def)).toBe(false);
    trustStdioServers('proj-1', [server]);
    expect(isStdioTrusted('proj-1', server.def)).toBe(true);
    expect(isStdioTrusted('proj-1', { cmd: 'touch', args: ['/tmp/other'] })).toBe(false);
  });

  it('does not require allowlisting for HTTP MCP servers', () => {
    expect(isStdioTrusted('proj-1', { url: 'https://example.com/mcp' })).toBe(true);
  });
});
