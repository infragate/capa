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

  it('throws a clear error when the token is expired and refresh is unavailable', async () => {
    const db = makeDb(
      makeIntegration({
        expires_at: Date.now() - 60_000,
        refresh_token: null,
      })
    );
    const authFetch = new AuthenticatedFetch(db);

    await expect(authFetch.fetch(GITHUB_RAW_URL)).rejects.toThrow(/expired/i);
    await expect(authFetch.fetch(GITHUB_RAW_URL)).rejects.toThrow(/capa auth/i);
    expect(fetchCalls).toHaveLength(0);
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
});
