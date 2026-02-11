// PKCE (Proof Key for Code Exchange) utilities for OAuth2 authorization code flow
// Implements RFC 7636 with S256 challenge method

import { createHash, randomBytes } from 'crypto';

/**
 * Generate a cryptographically random code verifier
 * Per RFC 7636: unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 * Length: 43-128 characters
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes and encode as base64url (43 characters)
  return base64UrlEncode(randomBytes(32));
}

/**
 * Generate code challenge from code verifier using S256 method
 * S256: BASE64URL(SHA256(ASCII(code_verifier)))
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256').update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generate a random state parameter for OAuth2 flow (CSRF protection)
 */
export function generateState(): string {
  return base64UrlEncode(randomBytes(32));
}

/**
 * Base64URL encode (RFC 4648 Section 5)
 * Standard base64 with URL-safe characters and no padding
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
