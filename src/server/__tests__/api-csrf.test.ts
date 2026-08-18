import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  authorizeApiRequest,
  injectHtmlAuthToken,
  requireApiCsrf,
  requireMutatingJsonContentType,
  serverHttpOrigin,
} from '../api-guards';
import { initAuth, _resetAuthStateForTests } from '../auth-middleware';

const SERVER_ORIGIN = 'http://127.0.0.1:5912';
const TOKEN = 'test-secret-token';

function apiRequest(
  path: string,
  init: RequestInit & { origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set('Origin', init.origin);
  return new Request(`http://127.0.0.1:5912${path}`, {
    ...init,
    headers,
  });
}

describe('serverHttpOrigin', () => {
  it('builds the bind origin for IPv4 loopback', () => {
    expect(serverHttpOrigin('127.0.0.1', 5912)).toBe('http://127.0.0.1:5912');
  });

  it('brackets IPv6 bind hosts', () => {
    expect(serverHttpOrigin('::1', 5912)).toBe('http://[::1]:5912');
  });
});

describe('requireApiCsrf', () => {
  it('rejects a mutating request with a foreign Origin', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      origin: 'http://evil.example',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(requireApiCsrf(req, SERVER_ORIGIN)).toEqual({
      ok: false,
      reason: 'Forbidden',
      status: 403,
    });
  });

  it('rejects a mutating request with Sec-Fetch-Site: cross-site', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(requireApiCsrf(req, SERVER_ORIGIN)).toEqual({
      ok: false,
      reason: 'Forbidden',
      status: 403,
    });
  });

  it('accepts Origin equal to the server bind origin', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      origin: SERVER_ORIGIN,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(requireApiCsrf(req, SERVER_ORIGIN)).toEqual({ ok: true });
  });

  it('accepts CLI mutating requests that omit Origin', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(requireApiCsrf(req, SERVER_ORIGIN)).toEqual({ ok: true });
  });

  it('does not apply the CSRF origin gate to GET', () => {
    const req = apiRequest('/api/projects', {
      method: 'GET',
      origin: 'http://evil.example',
    });
    expect(requireApiCsrf(req, SERVER_ORIGIN)).toEqual({ ok: true });
  });
});

describe('requireMutatingJsonContentType', () => {
  it('rejects mutating /api requests with Content-Type: text/plain', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(requireMutatingJsonContentType(req)).toEqual({
      ok: false,
      reason: 'Unsupported Media Type',
      status: 415,
    });
  });

  it('accepts application/json', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(requireMutatingJsonContentType(req)).toEqual({ ok: true });
  });

  it('accepts application/json with a charset parameter', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(requireMutatingJsonContentType(req)).toEqual({ ok: true });
  });

  it('accepts multipart/form-data for file uploads', () => {
    const req = apiRequest('/api/projects/p/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=abc' },
    });
    expect(requireMutatingJsonContentType(req)).toEqual({ ok: true });
  });

  it('does not require Content-Type on GET', () => {
    const req = apiRequest('/api/projects', { method: 'GET' });
    expect(requireMutatingJsonContentType(req)).toEqual({ ok: true });
  });
});

describe('authorizeApiRequest', () => {
  beforeEach(() => {
    _resetAuthStateForTests();
    process.env.CAPA_AUTH_TOKEN = TOKEN;
    initAuth('127.0.0.1');
  });

  afterEach(() => {
    _resetAuthStateForTests();
  });

  const bind = { host: '127.0.0.1', port: 5912 };

  it('returns 401 for loopback POST /api/registries without a bearer token', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(authorizeApiRequest(req, bind)).toEqual({
      ok: false,
      reason: 'Unauthorized',
      status: 401,
    });
  });

  it('accepts same-origin mutating requests that carry the token', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      origin: SERVER_ORIGIN,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    expect(authorizeApiRequest(req, bind)).toEqual({ ok: true });
  });

  it('returns 403 when a valid token is paired with a foreign Origin', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      origin: 'https://attacker.example',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    expect(authorizeApiRequest(req, bind)).toEqual({
      ok: false,
      reason: 'Forbidden',
      status: 403,
    });
  });

  it('returns 403 when Sec-Fetch-Site is cross-site', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(authorizeApiRequest(req, bind)).toEqual({
      ok: false,
      reason: 'Forbidden',
      status: 403,
    });
  });

  it('returns 415 for mutating requests with Content-Type: text/plain', () => {
    const req = apiRequest('/api/registries', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'text/plain',
      },
    });
    expect(authorizeApiRequest(req, bind)).toEqual({
      ok: false,
      reason: 'Unsupported Media Type',
      status: 415,
    });
  });

  it('allows OPTIONS without a token', () => {
    const req = apiRequest('/api/registries', { method: 'OPTIONS' });
    expect(authorizeApiRequest(req, bind)).toEqual({ ok: true });
  });

  it('allows unauthenticated GET oauth callback HTML', () => {
    const req = apiRequest('/api/integrations/github/oauth/callback', {
      method: 'GET',
    });
    expect(authorizeApiRequest(req, bind)).toEqual({ ok: true });
  });
});

describe('injectHtmlAuthToken', () => {
  it('injects window.__CAPA_AUTH_TOKEN__ before </head>', () => {
    const html = '<html><head><title>t</title></head><body></body></html>';
    const out = injectHtmlAuthToken(html, 'abc123');
    expect(out).toContain('window.__CAPA_AUTH_TOKEN__="abc123"');
    expect(out.indexOf('__CAPA_AUTH_TOKEN__')).toBeLessThan(out.indexOf('</head>'));
  });
});
