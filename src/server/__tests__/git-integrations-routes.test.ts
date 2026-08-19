import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CapaDatabase } from '../../db/database';
import { resetSecretCryptoForTests } from '../../shared/secret-crypto';
import { GitIntegrationManager } from '../git-integration-manager';
import {
  type GitIntegrationsRouteDeps,
  handleGitHubOAuthCallback,
  handleGitHubOAuthStart,
  handleGitLabOAuthCallback,
} from '../git-integrations-routes';
import { buildOAuthBridgeHtml, gitOAuthCallbackNeedsBridge } from '../oauth-bridge';

describe('Git OAuth callback state binding', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let manager: GitIntegrationManager;
  let deps: GitIntegrationsRouteDeps;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-git-oauth-state-'));
    prevHome = process.env.HOME;
    prevProfile = process.env.USERPROFILE;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    resetSecretCryptoForTests();
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new GitIntegrationManager(db);
    deps = {
      gitIntegrationManager: manager,
      uiOrigin: () => 'http://127.0.0.1:5912',
      serverHost: '127.0.0.1',
      serverPort: 5912,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ login: 'tester' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
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

  function callbackRequest(body: Record<string, unknown>): Request {
    return new Request('http://127.0.0.1:5912/api/integrations/github/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects POST {access_token} without state/flowId with 400 and does not write git_integrations', async () => {
    const res = await handleGitHubOAuthCallback(
      deps,
      callbackRequest({ access_token: 'attacker-pat' }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/state|flowId/i);
    expect(db.getGitIntegration('github')).toBeNull();
  });

  it('stores the token when callback includes matching state from /oauth/start', async () => {
    const startRes = await handleGitHubOAuthStart(
      deps,
      new Request('http://127.0.0.1:5912/api/integrations/github/oauth/start', {
        method: 'POST',
      }),
    );
    expect(startRes.status).toBe(200);
    const started = await startRes.json();
    const nonce = started.state || started.flowId;
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(8);

    const authUrl = new URL(started.authorizationUrl);
    expect(authUrl.searchParams.get('state')).toBe(nonce);
    const redirect = authUrl.searchParams.get('redirect');
    expect(redirect).toBeTruthy();
    expect(new URL(redirect!).searchParams.get('state')).toBe(nonce);

    const res = await handleGitHubOAuthCallback(
      deps,
      callbackRequest({ access_token: 'legit-oauth-token', state: nonce }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('success=github');
    expect(db.getGitIntegration('github')?.access_token).toBe('legit-oauth-token');
  });

  it('rejects a reused consumed state and does not overwrite the stored token', async () => {
    const startRes = await handleGitHubOAuthStart(
      deps,
      new Request('http://127.0.0.1:5912/api/integrations/github/oauth/start', {
        method: 'POST',
      }),
    );
    const started = await startRes.json();
    const nonce = started.state || started.flowId;

    const first = await handleGitHubOAuthCallback(
      deps,
      callbackRequest({ access_token: 'first-token', flowId: nonce }),
    );
    expect(first.status).toBe(302);
    expect(db.getGitIntegration('github')?.access_token).toBe('first-token');

    const second = await handleGitHubOAuthCallback(
      deps,
      callbackRequest({ access_token: 'attacker-overwrite', state: nonce }),
    );
    expect(second.status).toBe(400);
    expect(db.getGitIntegration('github')?.access_token).toBe('first-token');
  });

  it('rejects GitLab callback POST {access_token} without state and does not write', async () => {
    const res = await handleGitLabOAuthCallback(
      deps,
      new Request('http://127.0.0.1:5912/api/integrations/gitlab/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: 'gl-attacker' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(db.getGitIntegration('gitlab')).toBeNull();
  });

  it('forwards state and flowId from the cloud GET query into the HTML bridge POST body', () => {
    const html = buildOAuthBridgeHtml('github');
    expect(html).toMatch(/params\.get\(['"]state['"]\)|pick\(['"]state['"]\)/);
    expect(html).toMatch(/body\.state/);
    expect(html).toMatch(/flowId|flow_id/);
  });

  it('serves the HTML bridge on GET when only state/flowId are present (tokens in hash)', async () => {
    const res = await handleGitHubOAuthCallback(
      deps,
      new Request(
        'http://127.0.0.1:5912/api/integrations/github/oauth/callback?state=abc&flowId=abc',
        { method: 'GET' },
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Finishing GitHub sign-in');
    expect(html).toContain('location.hash');
  });

  it('gitOAuthCallbackNeedsBridge accepts state-only and token query params', () => {
    expect(
      gitOAuthCallbackNeedsBridge(
        new URL('http://127.0.0.1:5912/api/integrations/github/oauth/callback?state=x'),
      ),
    ).toBe(true);
    expect(
      gitOAuthCallbackNeedsBridge(
        new URL('http://127.0.0.1:5912/api/integrations/github/oauth/callback?token=t'),
      ),
    ).toBe(true);
    expect(
      gitOAuthCallbackNeedsBridge(
        new URL('http://127.0.0.1:5912/api/integrations/github/oauth/callback?error=denied'),
      ),
    ).toBe(false);
  });
});
