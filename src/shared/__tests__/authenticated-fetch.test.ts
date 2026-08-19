import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuthenticatedFetch } from '../authenticated-fetch';
import {
  approveGitHttpCredential,
  resetGitCredentialsForTests,
} from '../git-credentials';
import { resetSecretCryptoForTests } from '../secret-crypto';
import type { CapaDatabase } from '../../db/database';
import type { GitIntegration } from '../../types/database';

const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/owner/repo/main/SKILL.md';

function makeIntegration(overrides: Partial<GitIntegration> = {}): GitIntegration {
  return {
    id: 1,
    platform: 'github',
    host: null,
    access_token: '',
    refresh_token: null,
    token_type: 'Bearer',
    expires_at: null,
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
  let home: string;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'capa-authfetch-'));
    prevHome = process.env.HOME;
    prevProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    resetSecretCryptoForTests();
    resetGitCredentialsForTests();
    fetchCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSecretCryptoForTests();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to unauthenticated fetch when the git helper has no token', async () => {
    const authFetch = new AuthenticatedFetch(makeDb(null));

    const response = await authFetch.fetch(GITHUB_RAW_URL);
    expect(response.status).toBe(200);

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0]!.init?.headers as Headers | undefined;
    expect(headers?.get?.('Authorization') ?? null).toBeNull();
  });

  it('includes the auth header from the git credential helper, not sqlite', async () => {
    approveGitHttpCredential('github.com', 'gho_test_token');
    const authFetch = new AuthenticatedFetch(makeDb(makeIntegration()));

    await authFetch.fetch(GITHUB_RAW_URL);

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0]!.init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('token gho_test_token');
  });

  it('returns a 200 response unchanged', async () => {
    approveGitHttpCredential('github.com', 'gho_test_token');
    const authFetch = new AuthenticatedFetch(makeDb(makeIntegration()));

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

    approveGitHttpCredential('github.com', 'gho_test_token');
    const authFetch = new AuthenticatedFetch(makeDb(makeIntegration()));

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

    approveGitHttpCredential('github.com', 'gho_test_token');
    const authFetch = new AuthenticatedFetch(makeDb(makeIntegration()));

    const response = await authFetch.fetch(GITHUB_RAW_URL);

    expect(response.status).toBe(404);
    expect(fetchCalls).toHaveLength(1);
    expect(AuthenticatedFetch.isPrivateRepoError(response)).toBe(false);
  });

  it('does not call capa.infragate.ai to refresh git tokens', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const authFetch = new AuthenticatedFetch(makeDb(makeIntegration()));
    await authFetch.fetch(GITHUB_RAW_URL);

    expect(fetchCalls.every((c) => !c.url.includes('capa.infragate.ai'))).toBe(true);
  });
});
