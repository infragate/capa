import { describe, it, expect, mock, beforeEach, afterEach, afterAll, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ensureServerMock = mock(async () => ({
  running: true,
  url: 'http://127.0.0.1:5912',
}));

mock.module('../../utils/server-manager', () => ({
  ensureServer: ensureServerMock,
  startServer: mock(async () => {}),
  stopServer: mock(async () => {}),
  getServerStatus: mock(async () => ({ running: false, url: undefined, pid: undefined })),
  restartServer: mock(async () => {}),
}));

const { authCommand } = await import('../auth');

function isolateHome(): { restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-auth-home-'));
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
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function captureConsole<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => {
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
      console.error = origErr;
    }
  })();
}

describe('authCommand', () => {
  let homeCtx: { restore: () => void };

  beforeEach(() => {
    homeCtx = isolateHome();
    ensureServerMock.mockClear();
  });

  afterEach(() => {
    homeCtx.restore();
  });

  it('module loads and exports a callable authCommand', () => {
    expect(typeof authCommand).toBe('function');
  });

  it('lists connected providers when called without a provider arg', async () => {
    const { stdout } = await captureConsole(() => authCommand());
    expect(stdout).toContain('Connected Git Providers');
    expect(ensureServerMock).toHaveBeenCalled();
  });

  it('exits with a clear error for an invalid provider format', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
    const { stdout } = await captureConsole(() => authCommand('not-a-valid-domain'));
    expect(stdout).toContain('Invalid provider');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits with a clear error for an unknown git provider', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
    const { stdout } = await captureConsole(() => authCommand('example.com'));
    expect(stdout).toContain('Unknown git provider: example.com');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  afterAll(() => {
    mock.restore();
  });
});
