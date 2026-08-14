import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  isSandboxEnvironment,
  hasGraphicalDisplay,
  isBrowserDisabledByEnv,
  browserLaunchBlockedReason,
  canLaunchBrowser,
} from '../environment';

// Env vars this module reads; saved/cleared before each test and restored after.
const MANAGED_ENV = [
  'CI',
  'CURSOR_AGENT',
  'CURSOR_CLOUD',
  'CODESPACES',
  'GITPOD_WORKSPACE_ID',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'REMOTE_CONTAINERS',
  'DEVCONTAINER',
  'CAPA_NO_BROWSER',
  'NO_BROWSER',
  'BROWSER',
  'DISPLAY',
  'WAYLAND_DISPLAY',
] as const;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('environment detection', () => {
  const saved: Record<string, string | undefined> = {};
  let savedPlatform: NodeJS.Platform;

  beforeEach(() => {
    savedPlatform = process.platform;
    for (const name of MANAGED_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    setPlatform(savedPlatform);
    for (const name of MANAGED_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  describe('isSandboxEnvironment', () => {
    it('is false when no sandbox markers are present', () => {
      expect(isSandboxEnvironment()).toBe(false);
    });

    it('detects generic CI', () => {
      process.env.CI = 'true';
      expect(isSandboxEnvironment()).toBe(true);
    });

    it('detects a Cursor cloud agent', () => {
      process.env.CURSOR_AGENT = '1';
      expect(isSandboxEnvironment()).toBe(true);
    });

    it('detects Codespaces / Gitpod / dev containers', () => {
      process.env.CODESPACES = 'true';
      expect(isSandboxEnvironment()).toBe(true);
      delete process.env.CODESPACES;
      process.env.GITPOD_WORKSPACE_ID = 'abc';
      expect(isSandboxEnvironment()).toBe(true);
      delete process.env.GITPOD_WORKSPACE_ID;
      process.env.REMOTE_CONTAINERS = 'true';
      expect(isSandboxEnvironment()).toBe(true);
    });
  });

  describe('hasGraphicalDisplay', () => {
    it('is always true on macOS', () => {
      setPlatform('darwin');
      expect(hasGraphicalDisplay()).toBe(true);
    });

    it('is always true on Windows', () => {
      setPlatform('win32');
      expect(hasGraphicalDisplay()).toBe(true);
    });

    it('requires DISPLAY or WAYLAND_DISPLAY on Linux', () => {
      setPlatform('linux');
      expect(hasGraphicalDisplay()).toBe(false);
      process.env.DISPLAY = ':0';
      expect(hasGraphicalDisplay()).toBe(true);
      delete process.env.DISPLAY;
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      expect(hasGraphicalDisplay()).toBe(true);
    });
  });

  describe('isBrowserDisabledByEnv', () => {
    it('is false by default', () => {
      expect(isBrowserDisabledByEnv()).toBe(false);
    });

    it('honours CAPA_NO_BROWSER and NO_BROWSER', () => {
      process.env.CAPA_NO_BROWSER = '1';
      expect(isBrowserDisabledByEnv()).toBe(true);
      delete process.env.CAPA_NO_BROWSER;
      process.env.NO_BROWSER = '1';
      expect(isBrowserDisabledByEnv()).toBe(true);
    });

    it('honours BROWSER=none/false/0 but not a real browser command', () => {
      process.env.BROWSER = 'none';
      expect(isBrowserDisabledByEnv()).toBe(true);
      process.env.BROWSER = 'firefox';
      expect(isBrowserDisabledByEnv()).toBe(false);
    });
  });

  describe('browserLaunchBlockedReason / canLaunchBrowser', () => {
    it('allows a launch on an interactive desktop (macOS, no sandbox)', () => {
      setPlatform('darwin');
      expect(browserLaunchBlockedReason()).toBeNull();
      expect(canLaunchBrowser()).toBe(true);
    });

    it('blocks in a cloud sandbox even when a display exists', () => {
      setPlatform('linux');
      process.env.DISPLAY = ':1';
      process.env.CURSOR_AGENT = '1';
      expect(canLaunchBrowser()).toBe(false);
      expect(browserLaunchBlockedReason()).toContain('sandbox');
    });

    it('blocks on a headless Linux host with no display', () => {
      setPlatform('linux');
      expect(canLaunchBrowser()).toBe(false);
      expect(browserLaunchBlockedReason()).toContain('display');
    });

    it('blocks when explicitly disabled via env', () => {
      setPlatform('darwin');
      process.env.NO_BROWSER = '1';
      expect(canLaunchBrowser()).toBe(false);
      expect(browserLaunchBlockedReason()).toContain('disabled');
    });
  });
});
