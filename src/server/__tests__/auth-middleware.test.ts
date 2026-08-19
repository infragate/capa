import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getCapaDir } from '../../shared/config';
import {
  isLoopbackHost,
  requireAuth,
  requireMcpAuth,
  initAuth,
  getAuthToken,
  getSpaAuthToken,
  _resetAuthStateForTests,
} from '../auth-middleware';

describe('auth-middleware', () => {
  beforeEach(() => {
    _resetAuthStateForTests();
  });

  afterEach(() => {
    _resetAuthStateForTests();
  });

  describe('isLoopbackHost', () => {
    it('returns true for loopback hosts', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
    });

    it('returns false for non-loopback hosts', () => {
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(isLoopbackHost('192.168.1.1')).toBe(false);
      expect(isLoopbackHost('example.com')).toBe(false);
    });
  });

  describe('requireAuth', () => {
    const nonLoopback = '0.0.0.0';
    const loopback = '127.0.0.1';

    beforeEach(() => {
      process.env.CAPA_AUTH_TOKEN = 'test-secret-token';
      initAuth(nonLoopback);
    });

    it('returns 401 on loopback when the bearer token is missing', () => {
      const req = new Request('http://127.0.0.1/api/registries', {
        method: 'POST',
      });
      expect(requireAuth(req, loopback)).toEqual({
        ok: false,
        reason: 'Unauthorized',
        status: 401,
      });
    });

    it('accepts a valid Bearer token on loopback', () => {
      const req = new Request('http://127.0.0.1/api/registries', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-secret-token' },
      });
      expect(requireAuth(req, loopback)).toEqual({ ok: true });
    });

    it('allows OPTIONS without a token', () => {
      const req = new Request('http://127.0.0.1/api/registries', {
        method: 'OPTIONS',
      });
      expect(requireAuth(req, loopback)).toEqual({ ok: true });
    });

    it('returns 401 when header is missing on non-loopback', () => {
      const req = new Request('http://0.0.0.0/api/projects');
      const result = requireAuth(req, nonLoopback);
      expect(result).toEqual({ ok: false, reason: 'Unauthorized', status: 401 });
    });

    it('returns 401 for wrong token on non-loopback', () => {
      const req = new Request('http://0.0.0.0/api/projects', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      const result = requireAuth(req, nonLoopback);
      expect(result).toEqual({ ok: false, reason: 'Unauthorized', status: 401 });
    });

    it('accepts correct Bearer token on non-loopback', () => {
      const req = new Request('http://0.0.0.0/api/projects', {
        headers: { Authorization: 'Bearer test-secret-token' },
      });
      expect(requireAuth(req, nonLoopback)).toEqual({ ok: true });
    });

    it('accepts X-Capa-Auth-Token header on non-loopback', () => {
      const req = new Request('http://0.0.0.0/api/projects', {
        headers: { 'X-Capa-Auth-Token': 'test-secret-token' },
      });
      expect(requireAuth(req, nonLoopback)).toEqual({ ok: true });
    });

    it('rejects auth tokens in query strings on loopback', () => {
      const req = new Request('http://127.0.0.1/api/projects?token=secret');
      const result = requireAuth(req, loopback);
      expect(result).toEqual({
        ok: false,
        reason: 'Auth tokens must not be passed in query strings',
        status: 401,
      });
    });

    it('rejects auth tokens in query strings on non-loopback', () => {
      const req = new Request('http://0.0.0.0/api/projects?token=secret');
      const result = requireAuth(req, nonLoopback);
      expect(result).toEqual({
        ok: false,
        reason: 'Auth tokens must not be passed in query strings',
        status: 401,
      });
    });
  });

  describe('requireMcpAuth', () => {
    const loopback = '127.0.0.1';
    const nonLoopback = '0.0.0.0';

    beforeEach(() => {
      process.env.CAPA_AUTH_TOKEN = 'test-secret-token';
      initAuth(nonLoopback);
    });

    it('bypasses bearer auth on loopback so editor MCP clients keep working', () => {
      const req = new Request('http://127.0.0.1/proj/mcp', { method: 'POST' });
      expect(requireMcpAuth(req, loopback)).toEqual({ ok: true });
    });

    it('still requires a bearer token on non-loopback MCP binds', () => {
      const req = new Request('http://0.0.0.0/proj/mcp', { method: 'POST' });
      expect(requireMcpAuth(req, nonLoopback)).toEqual({
        ok: false,
        reason: 'Unauthorized',
        status: 401,
      });
    });
  });

  describe('initAuth token file', () => {
    let home: string;
    let prevHome: string | undefined;
    let prevProfile: string | undefined;

    beforeEach(() => {
      _resetAuthStateForTests();
      home = mkdtempSync(join(tmpdir(), 'capa-auth-token-home-'));
      prevHome = process.env.HOME;
      prevProfile = process.env.USERPROFILE;
      process.env.HOME = home;
      process.env.USERPROFILE = home;
    });

    afterEach(() => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevProfile;
      _resetAuthStateForTests();
      rmSync(home, { recursive: true, force: true });
    });

    it('generates ~/.capa/auth.token on loopback binds', () => {
      const dir = getCapaDir();
      expect(dir.startsWith(home)).toBe(true);
      const token = initAuth('127.0.0.1');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(getAuthToken()).toBe(token);
      expect(getSpaAuthToken()).toBe(token);
      expect(readFileSync(join(dir, 'auth.token'), 'utf8').trim()).toBe(
        token ?? '',
      );
    });

    it('does not expose the SPA bootstrap token when bound off-loopback', () => {
      const token = initAuth('0.0.0.0');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(getAuthToken()).toBe(token);
      expect(getSpaAuthToken()).toBeNull();
    });
  });
});
