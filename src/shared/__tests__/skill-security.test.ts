import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isTextFile,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
} from '../skill-security';
import type { SecurityOptions } from '../../types/capabilities';

describe('skill-security', () => {
  let tempDir: string;
  let capabilitiesPath: string;

  beforeAll(() => {
    tempDir = join(tmpdir(), `capa-skill-security-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    capabilitiesPath = join(tempDir, 'capabilities.json');
    writeFileSync(capabilitiesPath, '{}', 'utf-8');
  });

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadBlockedPhrases', () => {
    it('should return empty array when no security config', () => {
      expect(loadBlockedPhrases(undefined, capabilitiesPath)).toEqual([]);
    });

    it('should return empty array when blockedPhrases is omitted (disabled)', () => {
      expect(loadBlockedPhrases({}, capabilitiesPath)).toEqual([]);
    });

    it('should return inline phrases when array provided', () => {
      const security: SecurityOptions = {
        blockedPhrases: ['eval(', 'exec(', 'danger'],
      };
      expect(loadBlockedPhrases(security, capabilitiesPath)).toEqual([
        'eval(',
        'exec(',
        'danger',
      ]);
    });

    it('should filter empty strings from inline array', () => {
      const security: SecurityOptions = {
        blockedPhrases: ['a', '', 'b', '  ', 'c'],
      };
      expect(loadBlockedPhrases(security, capabilitiesPath)).toEqual(['a', 'b', 'c']);
    });

    it('should load phrases from file when file reference provided', () => {
      const phrasesPath = join(tempDir, 'blocked.txt');
      writeFileSync(
        phrasesPath,
        'phrase1\nphrase2\n\nphrase3\n  trimmed  \n',
        'utf-8'
      );
      const security: SecurityOptions = {
        blockedPhrases: { file: 'blocked.txt' },
      };
      const result = loadBlockedPhrases(security, capabilitiesPath);
      expect(result).toEqual(['phrase1', 'phrase2', 'phrase3', 'trimmed']);
    });

    it('should throw when blocked phrases file not found', () => {
      const security: SecurityOptions = {
        blockedPhrases: { file: 'nonexistent.txt' },
      };
      expect(() => loadBlockedPhrases(security, capabilitiesPath)).toThrow(
        /Blocked phrases file not found/
      );
    });
  });

  describe('checkBlockedPhrases', () => {
    it('should return not blocked when no phrases', () => {
      expect(checkBlockedPhrases('some content', [])).toEqual({ blocked: false });
    });

    it('should return not blocked when phrase not in content', () => {
      expect(checkBlockedPhrases('hello world', ['eval('])).toEqual({ blocked: false });
    });

    it('should return blocked when phrase in content', () => {
      expect(checkBlockedPhrases('use eval() here', ['eval('])).toEqual({
        blocked: true,
        phrase: 'eval(',
      });
    });

    it('should be case-sensitive', () => {
      expect(checkBlockedPhrases('EVAL()', ['eval('])).toEqual({ blocked: false });
      expect(checkBlockedPhrases('eval()', ['eval('])).toEqual({
        blocked: true,
        phrase: 'eval(',
      });
    });
  });

  describe('sanitizeContent', () => {
    it('should always preserve printable ASCII (baseline) regardless of user allow-list', () => {
      // @ and # are in printable ASCII baseline — preserved even though not in [a-zA-Z0-9\s]
      const result = sanitizeContent('hello@world#123', '[a-zA-Z0-9\\s]');
      expect(result).toBe('hello@world#123');
    });

    it('should strip non-ASCII Unicode when not covered by user allow-list', () => {
      // ✓ (U+2713) is outside the ASCII baseline; empty extra allow-list = baseline only
      const result = sanitizeContent('ok\u2713fail', '');
      expect(result).toBe('ok fail');
    });

    it('should strip control characters (below U+0020) that are not tab/LF/CR', () => {
      // Null byte (U+0000) is not in baseline
      const result = sanitizeContent('abc\u0000def', '');
      expect(result).toBe('abc def');
    });

    it('should preserve baseline chars even with a restrictive allow-list', () => {
      // Colon, dash, quote — markdown-critical chars — always preserved via baseline
      const result = sanitizeContent('key: "value"\n- item', '[a-z]');
      expect(result).toBe('key: "value"\n- item');
    });

    it('should preserve CR (Windows line endings) via baseline', () => {
      const result = sanitizeContent('line1\r\nline2', '');
      expect(result).toBe('line1\r\nline2');
    });

    it('should allow extended Unicode when specified by user', () => {
      // ✓ is U+2713, within [\\u2600-\\u27FF]
      const result = sanitizeContent('status \u2713 ok', '[\\u2600-\\u27FF]');
      expect(result).toBe('status \u2713 ok');
    });

    it('should strip Unicode outside the combined baseline + user allow-list', () => {
      // 📦 (U+1F4E6) is not in ASCII or [\\u2600-\\u27FF]
      const result = sanitizeContent('box\uD83D\uDCE6end', '[\\u2600-\\u27FF]');
      expect(result).toBe('box  end'); // surrogate pair = two replacements
    });
  });

  describe('getAllowedCharacters', () => {
    it('should return null when security undefined (disabled)', () => {
      expect(getAllowedCharacters(undefined)).toBeNull();
    });

    it('should return custom when provided', () => {
      const security: SecurityOptions = {
        allowedCharacters: '[a-z]',
      };
      expect(getAllowedCharacters(security)).toBe('[a-z]');
    });

    it('should return null when omitted (disabled)', () => {
      expect(getAllowedCharacters({})).toBeNull();
    });

    it('should return empty string when explicitly set to empty (baseline-only sanitization)', () => {
      expect(getAllowedCharacters({ allowedCharacters: '' })).toBe('');
    });

    it('should return null when allowedCharacters is non-string', () => {
      expect(getAllowedCharacters({ allowedCharacters: [] as any })).toBeNull();
      expect(getAllowedCharacters({ allowedCharacters: 123 as any })).toBeNull();
    });
  });

  describe('isBlockedPhrasesEnabled', () => {
    it('should return false when security undefined', () => {
      expect(isBlockedPhrasesEnabled(undefined)).toBe(false);
    });
    it('should return false when blockedPhrases is omitted', () => {
      expect(isBlockedPhrasesEnabled({})).toBe(false);
    });
    it('should return true when blockedPhrases is present', () => {
      expect(isBlockedPhrasesEnabled({ blockedPhrases: ['a'] })).toBe(true);
    });
  });

  describe('isCharacterSanitizationEnabled', () => {
    it('should return false when security undefined', () => {
      expect(isCharacterSanitizationEnabled(undefined)).toBe(false);
    });
    it('should return false when allowedCharacters is omitted', () => {
      expect(isCharacterSanitizationEnabled({})).toBe(false);
    });
    it('should return true when allowedCharacters is present', () => {
      expect(isCharacterSanitizationEnabled({ allowedCharacters: '[a-z]' })).toBe(true);
    });
  });

  describe('isTextFile', () => {
    it('should return true for text extensions', () => {
      expect(isTextFile('file.md')).toBe(true);
      expect(isTextFile('file.txt')).toBe(true);
      expect(isTextFile('file.ts')).toBe(true);
      expect(isTextFile('file.json')).toBe(true);
      expect(isTextFile('SKILL.md')).toBe(true);
    });

    it('should return false for non-text extensions', () => {
      expect(isTextFile('file.png')).toBe(false);
      expect(isTextFile('file.exe')).toBe(false);
      expect(isTextFile('file')).toBe(false);
    });
  });
});
