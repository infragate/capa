import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { GitIntegrationManager } from '../git-integration-manager';

describe('GitIntegrationManager', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let manager: GitIntegrationManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-git-int-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new GitIntegrationManager(db);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('constructs without throwing', () => {
    expect(manager).toBeInstanceOf(GitIntegrationManager);
  });

  it('reports connected state per platform via isConnected', () => {
    expect(manager.isConnected('github')).toBe(false);

    db.setGitIntegration('github', {
      access_token: 'gh-token',
      token_type: 'Bearer',
    });

    expect(manager.isConnected('github')).toBe(true);
    expect(manager.isConnected('gitlab')).toBe(false);
  });

  it('maps platforms to display names in getAllIntegrations', () => {
    db.setGitIntegration('github', { access_token: 'gh', token_type: 'Bearer' });
    db.setGitIntegration('gitlab', { access_token: 'gl', token_type: 'Bearer' });

    const integrations = manager.getAllIntegrations();
    const byPlatform = Object.fromEntries(integrations.map((i) => [i.platform, i.displayName]));

    expect(byPlatform.github).toBe('GitHub');
    expect(byPlatform.gitlab).toBe('GitLab');
  });

  it('returns null token and false refresh for unsupported platform', async () => {
    db.setGitIntegration('github-enterprise', {
      host: 'git.example.com',
      access_token: 'pat',
      refresh_token: 'refresh',
      token_type: 'token',
      expires_at: Date.now() - 1000,
    });

    expect(await manager.getAccessToken('github-enterprise', 'git.example.com')).toBe('pat');
    expect(await manager.refreshAccessToken('github-enterprise', 'git.example.com')).toBe(false);
  });

  it('returns null when no integration exists for a platform', async () => {
    expect(await manager.getAccessToken('gitlab')).toBeNull();
  });

  describe('storePAT', () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls: Array<{ url: string; authorization: string | null }>;

    beforeEach(() => {
      fetchCalls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const authorization =
          init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
            ? ((init.headers as Record<string, string>).Authorization ?? null)
            : null;
        fetchCalls.push({ url, authorization });

        if (url.includes('/user') && authorization?.includes('bad-token')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response(JSON.stringify({ login: 'tester' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('stores a cloud GitHub PAT with null host and clears refresh metadata', async () => {
      db.setGitIntegration('github', {
        access_token: 'old-oauth',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_at: Date.now() + 60_000,
      });

      await manager.storePAT({ platform: 'github', token: 'ghp_valid' });

      const stored = db.getGitIntegration('github');
      expect(stored?.access_token).toBe('ghp_valid');
      expect(stored?.host).toBeNull();
      expect(stored?.refresh_token).toBeNull();
      expect(stored?.expires_at).toBeNull();
      expect(stored?.token_type).toBe('token');
      expect(fetchCalls[0]?.url).toBe('https://api.github.com/user');
      expect(fetchCalls[0]?.authorization).toBe('token ghp_valid');
    });

    it('stores a cloud GitLab PAT', async () => {
      await manager.storePAT({ platform: 'gitlab', token: 'glpat_valid' });

      const stored = db.getGitIntegration('gitlab');
      expect(stored?.access_token).toBe('glpat_valid');
      expect(stored?.host).toBeNull();
      expect(fetchCalls[0]?.url).toBe('https://gitlab.com/api/v4/user');
      expect(fetchCalls[0]?.authorization).toBe('Bearer glpat_valid');
    });

    it('stores a GitHub Enterprise PAT at the given host', async () => {
      await manager.storePAT({
        platform: 'github-enterprise',
        host: 'git.example.com',
        token: 'ghe_valid',
      });

      const stored = db.getGitIntegration('github-enterprise', 'git.example.com');
      expect(stored?.access_token).toBe('ghe_valid');
      expect(stored?.host).toBe('git.example.com');
      expect(fetchCalls[0]?.url).toBe('https://git.example.com/api/v3/user');
    });

    it('throws when self-hosted PAT is missing a host', async () => {
      await expect(
        manager.storePAT({ platform: 'github-enterprise', token: 'x' }),
      ).rejects.toThrow(/Host is required/);
    });

    it('throws when the token fails validation', async () => {
      await expect(
        manager.storePAT({ platform: 'github', token: 'bad-token' }),
      ).rejects.toThrow(/Invalid Personal Access Token/);
    });
  });
});
