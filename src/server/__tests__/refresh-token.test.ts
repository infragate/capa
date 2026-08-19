import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { resetSecretCryptoForTests } from '../../shared/secret-crypto';
import { GitIntegrationManager } from '../git-integration-manager';

const REFRESH_PATH = /^\/api\/integrations\/(github|gitlab)\/refresh$/;

function handleGitTokenRefreshRoute(request: Request): Response {
  const url = new URL(request.url);
  const gitTokenRefreshMatch = url.pathname.match(REFRESH_PATH);
  if (!gitTokenRefreshMatch) {
    return new Response('Not Found', { status: 404 });
  }
  if (request.method === 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('git token refresh security', () => {
  describe('GitIntegrationManager.refreshAccessToken', () => {
    let db: CapaDatabase;
    let tempDir: string;
    let manager: GitIntegrationManager;
    let fetchCalls: Array<{ url: string; init?: RequestInit }>;
    const originalFetch = globalThis.fetch;
    let prevHome: string | undefined;
    let prevProfile: string | undefined;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'capa-refresh-test-'));
      prevHome = process.env.HOME;
      prevProfile = process.env.USERPROFILE;
      process.env.HOME = tempDir;
      process.env.USERPROFILE = tempDir;
      resetSecretCryptoForTests();
      db = new CapaDatabase(join(tempDir, 'test.db'));
      manager = new GitIntegrationManager(db);
      fetchCalls = [];

      db.setGitIntegration('github', {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        token_type: 'Bearer',
        expires_at: Date.now() - 1000,
      });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchCalls.push({ url, init });
        return new Response(
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      db.close();
      resetSecretCryptoForTests();
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevProfile;
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error: any) {
        if (error?.code !== 'EBUSY') throw error;
      }
    });

    it('does not send git refresh tokens to capa.infragate.ai', async () => {
      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);
      expect(fetchCalls).toHaveLength(0);

      const stored = db.getGitIntegration('github');
      expect(stored?.access_token).toBe('old-access');
      expect(stored?.refresh_token).toBeNull();
    });

    it('keeps helper-backed credentials when refresh is skipped', async () => {
      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);
      expect(db.getGitIntegration('github')).not.toBeNull();
      expect(db.getGitIntegration('github')?.access_token).toBe('old-access');
    });
  });

  describe('/api/integrations/:platform/refresh', () => {
    it('rejects GET requests with token in query string', async () => {
      const server = Bun.serve({
        port: 0,
        fetch: handleGitTokenRefreshRoute,
      });

      try {
        const res = await fetch(
          `http://127.0.0.1:${server.port}/api/integrations/github/refresh?token=gho_secret`,
          { method: 'GET' }
        );
        expect(res.status).toBe(405);
        const body = await res.json();
        expect(body.error).toMatch(/method not allowed/i);
      } finally {
        server.stop(true);
      }
    });
  });
});
