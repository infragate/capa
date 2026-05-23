import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  isLoopbackHost,
  requireAuth,
  initAuth,
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

    it('bypasses auth on loopback hosts', () => {
      const req = new Request('http://127.0.0.1/api/projects');
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
});
