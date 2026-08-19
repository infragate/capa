import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
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
import * as fs from 'fs';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type { ServerSettings } from '../../types/database';

const skipModeAsserts = process.platform === 'win32';

function isolateHome(): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-config-home-'));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore() {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevProfile;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('config', () => {
  describe('path getters', () => {
    it('should get capa directory', () => {
      const capaDir = getCapaDir();
      expect(capaDir).toBe(join(homedir(), '.capa'));
    });

    it('follows process.env.HOME / USERPROFILE so tests do not touch the real ~/.capa', () => {
      const { home, restore } = isolateHome();
      try {
        expect(getCapaDir()).toBe(join(home, '.capa'));
        expect(getSettingsPath()).toBe(join(home, '.capa', 'settings.json'));
      } finally {
        restore();
      }
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

    it('restricts ~/.capa to 0700 on every call, including existing dirs', async () => {
      const { home, restore } = isolateHome();
      try {
        expect(getCapaDir().startsWith(home)).toBe(true);
        const capaDir = getCapaDir();
        mkdirSync(capaDir, { recursive: true });
        try {
          chmodSync(capaDir, 0o755);
        } catch {
          // win32 may ignore chmod
        }
        await ensureCapaDir();
        expect(existsSync(capaDir)).toBe(true);
        if (!skipModeAsserts) {
          expect(modeOf(capaDir)).toBe(0o700);
        }
        try {
          chmodSync(capaDir, 0o755);
        } catch {
          // ignore
        }
        await ensureCapaDir();
        if (!skipModeAsserts) {
          expect(modeOf(capaDir)).toBe(0o700);
        }
      } finally {
        restore();
      }
    });

    it('restricts capa.db, wal/shm sidecars, and settings.json to 0600', async () => {
      const { home, restore } = isolateHome();
      try {
        const capaDir = getCapaDir();
        mkdirSync(capaDir, { recursive: true });
        const dbPath = join(capaDir, 'capa.db');
        const settingsPath = getSettingsPath();
        writeFileSync(dbPath, 'sqlite');
        writeFileSync(`${dbPath}-wal`, 'wal');
        writeFileSync(`${dbPath}-shm`, 'shm');
        writeFileSync(settingsPath, '{}');
        try {
          chmodSync(dbPath, 0o644);
          chmodSync(`${dbPath}-wal`, 0o644);
          chmodSync(`${dbPath}-shm`, 0o644);
          chmodSync(settingsPath, 0o644);
        } catch {
          // win32 may ignore chmod
        }
        await ensureCapaDir();
        if (!skipModeAsserts) {
          expect(modeOf(dbPath)).toBe(0o600);
          expect(modeOf(`${dbPath}-wal`)).toBe(0o600);
          expect(modeOf(`${dbPath}-shm`)).toBe(0o600);
          expect(modeOf(settingsPath)).toBe(0o600);
        }
      } finally {
        restore();
      }
    });

    it('invokes chmodSync for ~/.capa (0700) and credential files (0600)', async () => {
      const { restore } = isolateHome();
      const spy = spyOn(fs, 'chmodSync');
      try {
        const capaDir = getCapaDir();
        mkdirSync(capaDir, { recursive: true });
        const dbPath = join(capaDir, 'capa.db');
        const settingsPath = getSettingsPath();
        writeFileSync(dbPath, 'sqlite');
        writeFileSync(settingsPath, '{}');
        await ensureCapaDir();
        const calls = spy.mock.calls.map(([p, m]) => [String(p), m as number] as const);
        expect(calls.some(([p, m]) => p === capaDir && m === 0o700)).toBe(true);
        expect(calls.some(([p, m]) => p === dbPath && m === 0o600)).toBe(true);
        expect(calls.some(([p, m]) => p === settingsPath && m === 0o600)).toBe(true);
      } finally {
        spy.mockRestore();
        restore();
      }
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
