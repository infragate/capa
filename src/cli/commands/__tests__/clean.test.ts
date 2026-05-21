import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanCommand } from '../clean';

function isolateHome(): { restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-clean-home-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    restore: () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      try {
        rmSync(home, { recursive: true, force: true });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EBUSY') throw error;
      }
    },
  };
}

function captureConsole<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      const result = await fn();
      return { stdout: lines.join('\n'), result };
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    }
  })();
}

describe('cleanCommand', () => {
  let projectDir: string;
  let homeCtx: { restore: () => void };
  let originalCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-clean-project-'));
    homeCtx = isolateHome();
    originalCwd = process.cwd();
    process.chdir(projectDir);

    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      `options:
  toolExposure: on-demand
skills: []
servers: []
tools: []
`,
      'utf-8'
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homeCtx.restore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('module loads and exports cleanCommand', () => {
    expect(typeof cleanCommand).toBe('function');
  });

  it('exits cleanly when there are no managed files', async () => {
    const { stdout } = await captureConsole(() => cleanCommand());
    expect(stdout).toContain('No files to clean.');
    expect(stdout).toContain('Cleanup complete!');
  });
});
