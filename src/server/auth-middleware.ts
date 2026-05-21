import { randomBytes, timingSafeEqual } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getCapaDir } from '../shared/config';

let bindHost: string | undefined;
let cachedToken: string | null | undefined;

const AUTH_QUERY_PARAMS = ['token', 'auth', 'access_token', 'capa_auth_token'];

function authTokenPath(): string {
  return join(getCapaDir(), 'auth.token');
}

function resolveToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  const envToken = process.env.CAPA_AUTH_TOKEN?.trim();
  if (envToken) {
    cachedToken = envToken;
    return cachedToken;
  }

  const path = authTokenPath();
  if (existsSync(path)) {
    cachedToken = readFileSync(path, 'utf8').trim();
    return cachedToken;
  }

  if (bindHost && !isLoopbackHost(bindHost)) {
    const token = randomBytes(32).toString('hex');
    const capaDir = getCapaDir();
    mkdirSync(capaDir, { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort on platforms that don't support chmod
    }
    cachedToken = token;
    return cachedToken;
  }

  cachedToken = null;
  return null;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

/** Call once at startup with the server bind host before serving requests. */
export function initAuth(host: string): string | null {
  bindHost = host;
  return resolveToken();
}

export function getAuthToken(): string | null {
  return resolveToken();
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(providedBuf, providedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

function extractProvidedToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      return token;
    }
  }

  const capaHeader = req.headers.get('X-Capa-Auth-Token')?.trim();
  if (capaHeader) {
    return capaHeader;
  }

  return null;
}

export function requireAuth(
  req: Request,
  host: string
): { ok: true } | { ok: false; reason: string; status: number } {
  if (isLoopbackHost(host)) {
    return { ok: true };
  }

  if (req.method === 'OPTIONS') {
    return { ok: true };
  }

  const url = new URL(req.url);
  for (const param of AUTH_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      return {
        ok: false,
        reason: 'Auth tokens must not be passed in query strings',
        status: 401,
      };
    }
  }

  const expected = getAuthToken();
  if (!expected) {
    return { ok: false, reason: 'Unauthorized', status: 401 };
  }

  const provided = extractProvidedToken(req);
  if (!provided) {
    return { ok: false, reason: 'Unauthorized', status: 401 };
  }

  if (!tokensMatch(provided, expected)) {
    return { ok: false, reason: 'Unauthorized', status: 401 };
  }

  return { ok: true };
}

/** @internal Resets module state for tests. */
export function _resetAuthStateForTests(): void {
  bindHost = undefined;
  cachedToken = undefined;
  delete process.env.CAPA_AUTH_TOKEN;
}
