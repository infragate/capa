import { describe, it, expect } from 'bun:test';
import {
  buildOAuthBridgeHtml,
  gitOAuthCallbackNeedsBridge,
  normalizeOAuthCallbackQuery,
  parseOAuthCallbackSearchParams,
  oauthBridgeResponse,
} from '../oauth-bridge';

/**
 * The cloud OAuth provider redirects via GET with `?access_token=...` in the query
 * string. The local server responds with an HTML+JS bridge that strips those
 * tokens from the URL bar and re-issues the callback as a POST + JSON body, which
 * is the spec-compliant ingress for token submission.
 */
describe('git OAuth callback bridge', () => {
  describe('buildOAuthBridgeHtml', () => {
    it('targets the correct same-origin callback path for gitlab', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      expect(html).toContain('/api/integrations/gitlab/oauth/callback');
      expect(html).not.toContain('/api/integrations/github/oauth/callback');
    });

    it('targets the correct same-origin callback path for github', () => {
      const html = buildOAuthBridgeHtml('github');
      expect(html).toContain('/api/integrations/github/oauth/callback');
      expect(html).not.toContain('/api/integrations/gitlab/oauth/callback');
    });

    it('strips tokens from URL via history.replaceState before any other work', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      const replaceIdx = html.indexOf('history.replaceState');
      const postIdx = html.indexOf("method: 'POST'");
      expect(replaceIdx).toBeGreaterThan(-1);
      expect(postIdx).toBeGreaterThan(-1);
      expect(replaceIdx).toBeLessThan(postIdx);
    });

    it('reads tokens from query and hash (access_token, token alias)', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      expect(html).toContain('window.location.search');
      expect(html).toContain(".replace(/\\?/g, '&')");
      expect(html).toContain('location.hash');
      expect(html).toContain("pick('access_token', 'token')");
      expect(html).toContain("pick('refresh_token')");
      expect(html).toContain("pick('expires_in')");
    });

    it('re-issues the callback as POST with JSON body', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      expect(html).toContain("method: 'POST'");
      expect(html).toContain("'Content-Type': 'application/json'");
      expect(html).toContain('JSON.stringify(body)');
    });

    it('redirects to /ui/integrations on both success and error', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      expect(html).toContain('/ui/integrations');
      expect(html).toContain('?success=gitlab');
      expect(html).toContain("'?error=' + encodeURIComponent");
    });

    it('sets Referrer-Policy via meta tag so the cloud URL never leaks', () => {
      const html = buildOAuthBridgeHtml('gitlab');
      expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/);
    });
  });

  describe('normalizeOAuthCallbackQuery', () => {
    it('coerces a second ? from cloud redirects into &', () => {
      const search =
        '?state=abc&flowId=abc?access_token=ghu_test&refresh_token=ghr_test&expires_in=28800&provider=github.com';
      const params = parseOAuthCallbackSearchParams(search);
      expect(params.get('state')).toBe('abc');
      expect(params.get('flowId')).toBe('abc');
      expect(params.get('access_token')).toBe('ghu_test');
      expect(params.get('refresh_token')).toBe('ghr_test');
      expect(params.get('expires_in')).toBe('28800');
      expect(normalizeOAuthCallbackQuery(search)).toBe(
        'state=abc&flowId=abc&access_token=ghu_test&refresh_token=ghr_test&expires_in=28800&provider=github.com',
      );
    });

    it('gitOAuthCallbackNeedsBridge detects access_token after normalization', () => {
      expect(
        gitOAuthCallbackNeedsBridge(
          new URL(
            'http://127.0.0.1:5912/api/integrations/github/oauth/callback?state=x&flowId=y?access_token=t',
          ),
        ),
      ).toBe(true);
    });
  });

  describe('oauthBridgeResponse', () => {
    it('returns an HTML response with no-store cache and no-referrer policy', async () => {
      const res = oauthBridgeResponse('gitlab');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const body = await res.text();
      expect(body).toContain('/api/integrations/gitlab/oauth/callback');
    });
  });
});
