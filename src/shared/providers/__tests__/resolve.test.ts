import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { CapaDatabase } from '../../../db/database';
import {
  validateProvider,
  resolveProvidersForInstall,
  resolveProvidersForClean,
} from '../resolve';

describe('Provider resolver', () => {
  let db: CapaDatabase;
  let tempDir: string;
  const projectId = 'test-proj';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-resolve-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: projectId, path: '/test/path' });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('validateProvider', () => {
    it('does not throw for known providers', () => {
      expect(() => validateProvider('cursor')).not.toThrow();
      expect(() => validateProvider('claude-code')).not.toThrow();
      expect(() => validateProvider('codex')).not.toThrow();
    });

    it('throws for unknown providers with a helpful message', () => {
      expect(() => validateProvider('nonexistent')).toThrow(/Unknown provider: nonexistent/);
      expect(() => validateProvider('nonexistent')).toThrow(/Supported providers/);
    });
  });

  describe('resolveProvidersForInstall', () => {
    it('flag wins over capabilities file', async () => {
      const result = await resolveProvidersForInstall({
        flagProvider: 'cursor',
        capabilitiesProviders: ['claude-code', 'codex'],
        db,
        projectId,
      });
      expect(result).toEqual(['cursor']);
    });

    it('flag validates provider id', async () => {
      await expect(
        resolveProvidersForInstall({
          flagProvider: 'nonexistent',
          db,
          projectId,
        })
      ).rejects.toThrow(/Unknown provider/);
    });

    it('capabilities file wins over DB', async () => {
      db.setProjectProviders(projectId, ['codex']);

      const result = await resolveProvidersForInstall({
        capabilitiesProviders: ['cursor', 'claude-code'],
        db,
        projectId,
      });
      expect(result).toEqual(['cursor', 'claude-code']);
    });

    it('capabilities file validates provider ids', async () => {
      await expect(
        resolveProvidersForInstall({
          capabilitiesProviders: ['cursor', 'invalid-provider'],
          db,
          projectId,
        })
      ).rejects.toThrow(/Unknown provider: invalid-provider/);
    });

    it('falls back to DB when no flag or capabilities providers', async () => {
      db.setProjectProviders(projectId, ['cursor']);

      const result = await resolveProvidersForInstall({
        db,
        projectId,
      });
      expect(result).toEqual(['cursor']);
    });

    it('treats empty capabilities providers array as absent', async () => {
      db.setProjectProviders(projectId, ['codex']);

      const result = await resolveProvidersForInstall({
        capabilitiesProviders: [],
        db,
        projectId,
      });
      expect(result).toEqual(['codex']);
    });

    it('errors in non-TTY when no source is available', async () => {
      // stdin.isTTY is undefined in test runners (non-TTY), so this exercises the error path
      await expect(
        resolveProvidersForInstall({
          db,
          projectId,
        })
      ).rejects.toThrow(/No provider specified/);
    });
  });

  describe('resolveProvidersForClean', () => {
    it('returns capabilities providers when present', () => {
      db.setProjectProviders(projectId, ['codex']);

      const result = resolveProvidersForClean({
        capabilitiesProviders: ['cursor'],
        db,
        projectId,
      });
      expect(result).toEqual(['cursor']);
    });

    it('falls back to DB when no capabilities providers', () => {
      db.setProjectProviders(projectId, ['claude-code']);

      const result = resolveProvidersForClean({
        db,
        projectId,
      });
      expect(result).toEqual(['claude-code']);
    });

    it('returns empty array when no source is available', () => {
      const result = resolveProvidersForClean({
        db,
        projectId,
      });
      expect(result).toEqual([]);
    });

    it('treats empty capabilities providers array as absent', () => {
      db.setProjectProviders(projectId, ['cursor']);

      const result = resolveProvidersForClean({
        capabilitiesProviders: [],
        db,
        projectId,
      });
      expect(result).toEqual(['cursor']);
    });
  });
});
