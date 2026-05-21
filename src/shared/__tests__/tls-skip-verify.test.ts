import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { shouldSkipTlsVerify } from '../tls-skip-verify';

describe('shouldSkipTlsVerify', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.CAPA_ALLOW_TLS_SKIP_VERIFY = process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
  });

  afterEach(() => {
    if (savedEnv.CAPA_ALLOW_TLS_SKIP_VERIFY === undefined) {
      delete process.env.CAPA_ALLOW_TLS_SKIP_VERIFY;
    } else {
      process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = savedEnv.CAPA_ALLOW_TLS_SKIP_VERIFY;
    }
  });

  it('returns false when env is not set even if requested is true', () => {
    expect(shouldSkipTlsVerify(true, 'tls-smoke-unset')).toBe(false);
  });

  it('returns true when env is 1 and requested is true', () => {
    process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = '1';
    expect(shouldSkipTlsVerify(true, 'tls-smoke-enabled')).toBe(true);
  });

  it('returns false when env is 1 but requested is false', () => {
    process.env.CAPA_ALLOW_TLS_SKIP_VERIFY = '1';
    expect(shouldSkipTlsVerify(false, 'tls-smoke-not-requested')).toBe(false);
  });
});
