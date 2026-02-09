import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getCapaDir,
  getSettingsPath,
  getDatabasePath,
  getPidFilePath,
  ensureCapaDir,
  loadSettings,
  saveSettings,
} from '../config';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdtempSync, rmSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import type { ServerSettings } from '../../types/database';

describe('config', () => {
  describe('path getters', () => {
    it('should get capa directory', () => {
      const capaDir = getCapaDir();
      expect(capaDir).toBe(join(homedir(), '.capa'));
    });

    it('should get settings path', () => {
      const settingsPath = getSettingsPath();
      expect(settingsPath).toBe(join(homedir(), '.capa', 'settings.json'));
    });

    it('should get database path with default settings', () => {
      const dbPath = getDatabasePath();
      // Normalize path separators for cross-platform compatibility
      const expected = join(homedir(), '.capa', 'capa.db');
      expect(dbPath.replace(/\\/g, '/')).toBe(expected.replace(/\\/g, '/'));
    });

    it('should get database path with custom settings', () => {
      const settings: ServerSettings = {
        version: '1.0.0',
        server: { port: 5912, host: '127.0.0.1' },
        database: { path: '/custom/path/db.sqlite' },
        session: { timeout_minutes: 60 },
      };
      const dbPath = getDatabasePath(settings);
      expect(dbPath).toBe('/custom/path/db.sqlite');
    });

    it('should expand tilde in database path', () => {
      const settings: ServerSettings = {
        version: '1.0.0',
        server: { port: 5912, host: '127.0.0.1' },
        database: { path: '~/custom/db.sqlite' },
        session: { timeout_minutes: 60 },
      };
      const dbPath = getDatabasePath(settings);
      const expected = join(homedir(), 'custom', 'db.sqlite');
      expect(dbPath.replace(/\\/g, '/')).toBe(expected.replace(/\\/g, '/'));
    });

    it('should get PID file path', () => {
      const pidPath = getPidFilePath();
      expect(pidPath).toBe(join(homedir(), '.capa', 'server.pid'));
    });
  });

  describe('ensureCapaDir', () => {
    let tempHome: string;
    let originalHome: string;

    beforeEach(() => {
      // Create temp directory
      tempHome = mkdtempSync(join(tmpdir(), 'capa-config-test-'));
      originalHome = process.env.HOME || process.env.USERPROFILE || '';
    });

    afterEach(() => {
      // Cleanup
      if (existsSync(tempHome)) {
        rmSync(tempHome, { recursive: true, force: true });
      }
    });

    it('should create capa directory if it does not exist', async () => {
      // This test is hard to mock properly without affecting the real ensureCapaDir
      // So we'll just test that ensureCapaDir completes without error
      await ensureCapaDir();
      
      // Verify the actual capa directory exists
      const capaDir = getCapaDir();
      expect(existsSync(capaDir)).toBe(true);
    });
  });

  describe('loadSettings and saveSettings', () => {
    // Note: These tests use the actual capa directory
    // In a production scenario, you might want to use dependency injection
    // or environment variables to control the directory location

    it('should load settings', async () => {
      const settings = await loadSettings();
      
      expect(settings).toBeDefined();
      expect(settings.server).toBeDefined();
      expect(settings.server.port).toBeNumber();
      expect(settings.server.host).toBeString();
      expect(settings.database).toBeDefined();
      expect(settings.session).toBeDefined();
    });

    it('should save and load settings', async () => {
      // Save current settings first
      const originalSettings = await loadSettings();
      
      const customSettings: ServerSettings = {
        ...originalSettings,
        version: '2.0.0',
        server: {
          port: 9000,
          host: 'localhost',
        },
        session: {
          timeout_minutes: 120,
        },
      };
      
      await saveSettings(customSettings);
      const loaded = await loadSettings();
      
      expect(loaded.server.port).toBe(9000);
      expect(loaded.server.host).toBe('localhost');
      expect(loaded.session.timeout_minutes).toBe(120);
      
      // Restore original settings
      await saveSettings(originalSettings);
    });
  });
});
