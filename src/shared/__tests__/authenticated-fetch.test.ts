import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AuthenticatedFetch } from '../authenticated-fetch';
import type { CapaDatabase } from '../../db/database';
import type { GitIntegration } from '../../types/database';

const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/owner/repo/main/SKILL.md';

function makeIntegration(overrides: Partial<GitIntegration> = {}): GitIntegration {
  return {
    id: 1,
    platform: 'github',
    host: null,
    access_token: 'gho_test_token',
    refresh_token: null,
    token_type: 'Bearer',
    expires_at: Date.now() + 60 * 60 * 1000,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeDb(integration: GitIntegration | null): CapaDatabase {
  return {
    getGitIntegration: () => integration,
    getAllGitIntegrations: () => (integration ? [integration] : []),
    setGitIntegration: () => {},
    deleteGitIntegration: () => {},
  } as unknown as CapaDatabase;
}

function makeDbWithSpies(integration: GitIntegration | null) {
  const deletes: Array<{ platform: string; host: string | null }> = [];
  const sets: Array<{ platform: string; tokenData: Record<string, unknown> }> = [];
  let current: GitIntegration | null = integration;
  const db = {
    getGitIntegration: () => current,
    getAllGitIntegrations: () => (current ? [current] : []),
    setGitIntegration: (platform: string, tokenData: Record<string, unknown>) => {
      sets.push({ platform, tokenData });
      if (current) {
        current = {
          ...current,
          access_token: String(tokenData.access_token ?? current.access_token),
          refresh_token: (tokenData.refresh_token as string | null | undefined) ?? current.refresh_token,
          expires_at: (tokenData.expires_at as number | null | undefined) ?? current.expires_at,
        };
      }
    },
    deleteGitIntegration: (platform: string, host: string | null) => {
      deletes.push({ platform, host });
      current = null;
    },
  } as unknown as CapaDatabase;
  return { db, deletes, sets, get current() { return current; } };
}

describe('AuthenticatedFetch', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('falls back to unauthenticated fetch when the token is expired and refresh is unavailable', async () => {
    const db = makeDb(
      makeIntegration({
        expires_at: Date.now() - 60_000,
        refresh_token: null,
      })
    );
    const authFetch = new AuthenticatedFetch(db);

    // Should not throw — the request proceeds without auth so public URLs still work.
    const response = await authFetch.fetch(GITHUB_RAW_URL);
    expect(response.status).toBe(200);

    // Fetch must have been called once (unauthenticated — no Authorization header).
    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0]!.init?.headers as Headers | undefined;
    expect(headers?.get?.('Authorization') ?? null).toBeNull();
  });

  it('includes the auth header when the token is valid and not expired', async () => {
    const db = makeDb(makeIntegration());
    const authFetch = new AuthenticatedFetch(db);

    await authFetch.fetch(GITHUB_RAW_URL);

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0]!.init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('token gho_test_token');
  });

  it('returns a 200 response unchanged', async () => {
    const db = makeDb(makeIntegration());
    const authFetch = new AuthenticatedFetch(db);

    const response = await authFetch.fetch(GITHUB_RAW_URL);

    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
  });

  it('returns a 401 response without a second fetch attempt', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    const db = makeDb(makeIntegration());
    const authFetch = new AuthenticatedFetch(db);

    const response = await authFetch.fetch(GITHUB_RAW_URL);

    expect(response.status).toBe(401);
    expect(fetchCalls).toHaveLength(1);
    expect(AuthenticatedFetch.isPrivateRepoError(response)).toBe(true);
  });

  it('returns a 404 response without treating it as an auth retry signal', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const db = makeDb(makeIntegration());
    const authFetch = new AuthenticatedFetch(db);

    const response = await authFetch.fetch(GITHUB_RAW_URL);

    expect(response.status).toBe(404);
    expect(fetchCalls).toHaveLength(1);
    expect(AuthenticatedFetch.isPrivateRepoError(response)).toBe(false);
  });

  describe('refresh failure classification', () => {
    it('keeps the stored token and falls back to unauthenticated fetch when the cloud refresh endpoint returns a transient 5xx', async () => {
      let targetFetchCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/auth/refresh')) {
          return new Response('bad gateway', { status: 502 });
        }
        targetFetchCalled = true;
        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      const harness = makeDbWithSpies(
        makeIntegration({
          expires_at: Date.now() - 60_000,
          refresh_token: 'still-valid-refresh',
        })
      );
      const authFetch = new AuthenticatedFetch(harness.db);

      // Falls back to unauthenticated — does not throw.
      const response = await authFetch.fetch(GITHUB_RAW_URL);
      expect(response.status).toBe(200);
      expect(targetFetchCalled).toBe(true);

      // Stored token must NOT be deleted on a transient failure.
      expect(harness.deletes).toHaveLength(0);
      expect(harness.current).not.toBeNull();
      expect(harness.current?.refresh_token).toBe('still-valid-refresh');
    });

    it('keeps the stored token and falls back to unauthenticated fetch when the refresh request throws a network error', async () => {
      let targetFetchCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/auth/refresh')) {
          throw new Error('ENOTFOUND capa.infragate.ai');
        }
        targetFetchCalled = true;
        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      const harness = makeDbWithSpies(
        makeIntegration({
          expires_at: Date.now() - 60_000,
          refresh_token: 'still-valid-refresh',
        })
      );
      const authFetch = new AuthenticatedFetch(harness.db);

      const response = await authFetch.fetch(GITHUB_RAW_URL);
      expect(response.status).toBe(200);
      expect(targetFetchCalled).toBe(true);

      expect(harness.deletes).toHaveLength(0);
      expect(harness.current).not.toBeNull();
    });

    it('deletes the stored token and falls back to unauthenticated fetch when the refresh_token is rejected as invalid_grant', async () => {
      let targetFetchCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/auth/refresh')) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        targetFetchCalled = true;
        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      const harness = makeDbWithSpies(
        makeIntegration({
          expires_at: Date.now() - 60_000,
          refresh_token: 'truly-revoked',
        })
      );
      const authFetch = new AuthenticatedFetch(harness.db);

      // Falls back to unauthenticated after clearing the bad token.
      const response = await authFetch.fetch(GITHUB_RAW_URL);
      expect(response.status).toBe(200);
      expect(targetFetchCalled).toBe(true);

      expect(harness.deletes).toHaveLength(1);
      expect(harness.deletes[0]).toEqual({ platform: 'github', host: null });
      expect(harness.current).toBeNull();
    });
  });
});
