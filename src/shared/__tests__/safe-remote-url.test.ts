import { describe, expect, it } from 'bun:test';
import {
  assertPublicHttpsUrl,
  isBlockedHostnameOrIp,
} from '../safe-remote-url';

describe('safe-remote-url', () => {
  describe('isBlockedHostnameOrIp', () => {
    it('blocks localhost and loopback', () => {
      expect(isBlockedHostnameOrIp('localhost')).toBe(true);
      expect(isBlockedHostnameOrIp('127.0.0.1')).toBe(true);
      expect(isBlockedHostnameOrIp('::1')).toBe(true);
    });

    it('blocks private and link-local ranges', () => {
      expect(isBlockedHostnameOrIp('10.0.0.1')).toBe(true);
      expect(isBlockedHostnameOrIp('192.168.1.1')).toBe(true);
      expect(isBlockedHostnameOrIp('172.16.0.1')).toBe(true);
      expect(isBlockedHostnameOrIp('169.254.169.254')).toBe(true);
    });

    it('allows public hostnames and IPs', () => {
      expect(isBlockedHostnameOrIp('example.com')).toBe(false);
      expect(isBlockedHostnameOrIp('8.8.8.8')).toBe(false);
    });
  });

  describe('assertPublicHttpsUrl', () => {
    it('rejects non-https schemes', async () => {
      await expect(assertPublicHttpsUrl('http://example.com/x')).rejects.toThrow(/https/i);
      await expect(assertPublicHttpsUrl('file:///etc/passwd')).rejects.toThrow(/https/i);
    });

    it('rejects credentials in the URL', async () => {
      await expect(
        assertPublicHttpsUrl('https://user:pass@example.com/x'),
      ).rejects.toThrow(/credentials/i);
    });

    it('rejects private IP literals', async () => {
      await expect(assertPublicHttpsUrl('https://127.0.0.1/secret')).rejects.toThrow();
      await expect(assertPublicHttpsUrl('https://10.0.0.5/secret')).rejects.toThrow();
    });

    it('accepts a public https IP literal', async () => {
      const u = await assertPublicHttpsUrl('https://8.8.8.8/SKILL.md');
      expect(u.hostname).toBe('8.8.8.8');
    });
  });
});
