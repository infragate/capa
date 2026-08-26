import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OAuth2Manager, isPermanentRefreshFailure, OAuth2DetectionStatus } from '../oauth-manager';
import { shouldSkipTlsVerify } from '../../shared/tls-skip-verify';
import type { CapaDatabase } from '../../db/database';

function makeMockDb(): CapaDatabase {
  return {
    getOAuthToken: () => null,
    setOAuthToken: () => {},
    deleteOAuthToken: () => {},
    storeFlowState: () => {},
    getFlowState: () => null,
    deleteFlowState: () => {},
    deleteExpiredFlowStates: () => {},
    getVariable: () => null,
    setVariable: () => {},
  } as unknown as CapaDatabase;
}

describe('OAuth2Manager', () => {
  let originalTlsEnv: string | undefined;

  beforeEach(() => {
    originalTlsEnv = process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
  });

  afterEach(() => {
    if (originalTlsEnv === undefined) {
      delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    } else {
      process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = originalTlsEnv;
    }
  });

  it('constructs without throwing on valid db config', () => {
    expect(() => new OAuth2Manager(makeMockDb())).not.toThrow();
  });

  it('accepts a capabilities provider via setCapabilitiesProvider', () => {
    const manager = new OAuth2Manager(makeMockDb());
    expect(() =>
      manager.setCapabilitiesProvider(() => new Map()),
    ).not.toThrow();
  });

	describe('isPermanentRefreshFailure', () => {
    it('classifies 401/403 with invalid_grant as permanent', () => {
      const res401 = new Response('', { status: 401 });
      expect(isPermanentRefreshFailure(undefined, res401, '{"error":"invalid_grant"}')).toBe(true);

      const res403 = new Response('', { status: 403 });
      expect(isPermanentRefreshFailure(undefined, res403, 'invalid_token')).toBe(true);
    });

    it('keeps tokens on bare 4xx without an explicit invalid/expired marker', () => {
      const res401 = new Response('', { status: 401 });
      expect(isPermanentRefreshFailure(undefined, res401, 'rate limited')).toBe(false);

      const res403 = new Response('', { status: 403 });
      expect(isPermanentRefreshFailure(undefined, res403, 'forbidden')).toBe(false);
    });

    it('treats 500 responses as transient even with invalid_grant in the body', () => {
      const res500 = new Response('', { status: 500 });
      expect(isPermanentRefreshFailure(undefined, res500, 'invalid_grant')).toBe(false);
    });

    it('treats missing response (network errors) as transient', () => {
      expect(isPermanentRefreshFailure(new Error('network failure'))).toBe(false);
    });
  });

  describe('detectOAuth2Requirement', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns inconclusive (does not throw) when the server is unreachable', async () => {
      // Simulate a connection-refused / aborted fetch — the same class of error
      // that an unreachable MCP server produces at the network layer.
      globalThis.fetch = (async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }) as unknown as typeof fetch;

      const manager = new OAuth2Manager(makeMockDb());
      const result = await manager.detectOAuth2Requirement('http://192.0.2.1:9999/mcp');
      expect(result.status).toBe(OAuth2DetectionStatus.INCONCLUSIVE);
    });

    it('returns not_required when unauthenticated initialize succeeds', async () => {
      globalThis.fetch = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;

      const manager = new OAuth2Manager(makeMockDb());
      const result = await manager.detectOAuth2Requirement('http://localhost:9999/mcp');
      expect(result.status).toBe(OAuth2DetectionStatus.NOT_REQUIRED);
    });

    it('returns inconclusive for non-401 client errors', async () => {
      globalThis.fetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;

      const manager = new OAuth2Manager(makeMockDb());
      const result = await manager.detectOAuth2Requirement('http://localhost:9999/mcp');
      expect(result.status).toBe(OAuth2DetectionStatus.INCONCLUSIVE);
    });
  });

  describe('tlsSkipVerify wiring', () => {
    it('returns false when env is unset even if config requests skip', () => {
      expect(shouldSkipTlsVerify(true, 'OAuth2 detection (test)')).toBe(false);
    });

    it('returns true only when env allows skip and config requests it', () => {
      process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = '1';
      expect(shouldSkipTlsVerify(true, 'OAuth2 detection (test)')).toBe(true);
      expect(shouldSkipTlsVerify(false, 'OAuth2 detection (test)')).toBe(false);
    });
  });
});
