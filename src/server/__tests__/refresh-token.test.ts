import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { GitIntegrationManager } from '../git-integration-manager';
import { CAPA_CLOUD_OAUTH_URL } from '../../shared/ui-urls';

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

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'capa-refresh-test-'));
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
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error: any) {
        if (error?.code !== 'EBUSY') throw error;
      }
    });

    it('sends refresh_token in POST body, not URL query', async () => {
      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(true);
      expect(fetchCalls).toHaveLength(1);

      const { url, init } = fetchCalls[0]!;
      expect(url).toBe(`${CAPA_CLOUD_OAUTH_URL}/refresh`);
      expect(url).not.toContain('refresh_token=');
      expect(init?.method).toBe('POST');

      const body = JSON.parse(String(init?.body));
      expect(body.provider).toBe('github.com');
      expect(body.refresh_token).toBe('old-refresh');
    });

    it('preserves the stored token when the cloud proxy returns a transient 5xx', async () => {
      globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response('upstream temporarily unavailable', {
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
        });
      }) as typeof fetch;

      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);

      const stored = db.getGitIntegration('github');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('old-access');
      expect(stored?.refresh_token).toBe('old-refresh');
    });

    it('preserves the stored token when the refresh request hits a network error', async () => {
      globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch;

      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);

      const stored = db.getGitIntegration('github');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('old-access');
    });

    it('preserves the stored token when the proxy returns 401 without an invalid_grant marker', async () => {
      globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response('rate limited', {
          status: 401,
          headers: { 'Content-Type': 'text/plain' },
        });
      }) as typeof fetch;

      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);

      const stored = db.getGitIntegration('github');
      expect(stored).not.toBeNull();
    });

    it('deletes the stored token when the cloud proxy reports invalid_grant', async () => {
      globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const ok = await manager.refreshAccessToken('github');
      expect(ok).toBe(false);

      const stored = db.getGitIntegration('github');
      expect(stored).toBeNull();
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
