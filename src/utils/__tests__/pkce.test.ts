import { describe, it, expect } from 'bun:test';
import { generateCodeVerifier, generateCodeChallenge } from '../pkce';

const ALLOWED_CHARS = /^[A-Za-z0-9\-._~]+$/;
const BASE64URL_NO_PADDING = /^[A-Za-z0-9\-_]+$/;

describe('pkce', () => {
  it('generateCodeVerifier returns a string within RFC 7636 length range', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('generateCodeVerifier only contains allowed characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(ALLOWED_CHARS);
  });

  it('generateCodeChallenge returns a Base64url string with no padding', () => {
    const challenge = generateCodeChallenge('test-verifier-value');
    expect(challenge).toMatch(BASE64URL_NO_PADDING);
    expect(challenge).not.toContain('=');
  });

  it('generateCodeChallenge is deterministic for the same verifier', () => {
    const verifier = 'fixed-verifier-for-determinism-test';
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });

  it('generateCodeChallenge differs for different verifiers', () => {
    const challenge1 = generateCodeChallenge('verifier-alpha');
    const challenge2 = generateCodeChallenge('verifier-beta');
    expect(challenge1).not.toBe(challenge2);
  });
});
