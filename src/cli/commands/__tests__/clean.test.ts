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

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function captureOutput<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    const capture = (chunk: unknown) => {
      if (typeof chunk === 'string') {
        lines.push(stripAnsi(chunk));
      }
    };

    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    process.stdout.write = ((chunk, ...args: unknown[]) => {
      capture(chunk);
      return (origStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk, ...args: unknown[]) => {
      capture(chunk);
      return (origStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write;

    try {
      const result = await fn();
      return { stdout: lines.join('\n'), result };
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
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
    const { stdout } = await captureOutput(() => cleanCommand());
    expect(stdout).toContain('No files to clean.');
    expect(stdout).toContain('Cleanup complete!');
  });
});
