import { describe, it, expect, afterEach } from 'bun:test';
import { isAllowedOrigin } from '../cors-origin';

describe('isAllowedOrigin', () => {
  const prev = process.env.CAPA_ALLOWED_ORIGINS;

  afterEach(() => {
    if (prev === undefined) delete process.env.CAPA_ALLOWED_ORIGINS;
    else process.env.CAPA_ALLOWED_ORIGINS = prev;
  });

  it('allows http localhost and IPv4 loopback', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toEqual({
      allowed: true,
      origin: 'http://localhost:5173',
    });
    expect(isAllowedOrigin('http://127.0.0.1:5912')).toEqual({
      allowed: true,
      origin: 'http://127.0.0.1:5912',
    });
  });

  it('allows http IPv6 loopback', () => {
    expect(isAllowedOrigin('http://[::1]:5173')).toEqual({
      allowed: true,
      origin: 'http://[::1]:5173',
    });
  });

  it('rejects non-loopback origins unless listed in CAPA_ALLOWED_ORIGINS', () => {
    delete process.env.CAPA_ALLOWED_ORIGINS;
    expect(isAllowedOrigin('http://example.com')).toEqual({ allowed: false });

    process.env.CAPA_ALLOWED_ORIGINS = 'https://app.example.com';
    expect(isAllowedOrigin('https://app.example.com')).toEqual({
      allowed: true,
      origin: 'https://app.example.com',
    });
  });
});
