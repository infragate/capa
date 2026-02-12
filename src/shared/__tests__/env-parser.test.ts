import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseEnvFile } from '../env-parser';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('env-parser', () => {
  let testDir: string;
  let testEnvFile: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    testDir = join(tmpdir(), `capa-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testEnvFile = join(testDir, '.env.test');
  });

  afterEach(() => {
    // Clean up test files
    try {
      unlinkSync(testEnvFile);
    } catch {}
  });

  describe('parseEnvFile', () => {
    it('should parse basic KEY=VALUE pairs', () => {
      const content = `API_KEY=secret123
DATABASE_URL=postgresql://localhost:5432/db`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: 'secret123',
        DATABASE_URL: 'postgresql://localhost:5432/db',
      });
    });

    it('should handle quoted values', () => {
      const content = `API_KEY="secret with spaces"
TOKEN='single quoted'`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: 'secret with spaces',
        TOKEN: 'single quoted',
      });
    });

    it('should skip comments and empty lines', () => {
      const content = `# This is a comment
API_KEY=secret123

# Another comment
TOKEN=abc123
`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: 'secret123',
        TOKEN: 'abc123',
      });
    });

    it('should handle values with = signs', () => {
      const content = `BASE64=dGVzdD1kYXRh==`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        BASE64: 'dGVzdD1kYXRh==',
      });
    });

    it('should trim whitespace around keys and values', () => {
      const content = `  API_KEY  =  secret123  
  TOKEN  =  abc  `;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: 'secret123',
        TOKEN: 'abc',
      });
    });

    it('should handle values with variable syntax', () => {
      const content = `DATABASE_URL=postgresql://\${DB_HOST}:5432/db
API_URL=https://\${API_HOST}/api`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        DATABASE_URL: 'postgresql://${DB_HOST}:5432/db',
        API_URL: 'https://${API_HOST}/api',
      });
    });

    it('should skip invalid lines without = sign', () => {
      const content = `API_KEY=secret123
INVALID_LINE_WITHOUT_EQUALS
TOKEN=abc123`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: 'secret123',
        TOKEN: 'abc123',
      });
    });

    it('should handle empty values', () => {
      const content = `API_KEY=
TOKEN=abc123`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({
        API_KEY: '',
        TOKEN: 'abc123',
      });
    });

    it('should return empty object for empty file', () => {
      writeFileSync(testEnvFile, '', 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({});
    });

    it('should return empty object for file with only comments', () => {
      const content = `# Comment 1
# Comment 2
# Comment 3`;
      
      writeFileSync(testEnvFile, content, 'utf-8');
      const result = parseEnvFile(testEnvFile);
      
      expect(result).toEqual({});
    });
  });
});
