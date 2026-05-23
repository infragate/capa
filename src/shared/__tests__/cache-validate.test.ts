import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateRepoPath } from '../cache/validate';

describe('validateRepoPath', () => {
  let cacheDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'capa-cache-validate-'));
    savedEnv.CAPA_CACHE_DIR = process.env.CAPA_CACHE_DIR;
    process.env.CAPA_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    if (savedEnv.CAPA_CACHE_DIR === undefined) {
      delete process.env.CAPA_CACHE_DIR;
    } else {
      process.env.CAPA_CACHE_DIR = savedEnv.CAPA_CACHE_DIR;
    }
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('throws for an empty string', () => {
    expect(() => validateRepoPath('')).toThrow('Invalid repository path');
  });

  it('throws for a path containing a newline', () => {
    expect(() => validateRepoPath('owner/repo\n')).toThrow('Invalid repository path');
  });

  it('throws for a path containing control characters', () => {
    expect(() => validateRepoPath('owner/repo\x07')).toThrow('Invalid repository path');
  });

  it('throws for a path with .. segments that escape the cache root', () => {
    expect(() => validateRepoPath('../outside')).toThrow('Invalid repository path');
  });

  it('accepts a normal relative repo path', () => {
    expect(() => validateRepoPath('owner/repo')).not.toThrow();
  });
});
