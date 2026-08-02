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

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function captureOutput<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
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
      console.error = origErr;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
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
    const { stdout } = await captureOutput(() => authCommand());
    expect(stdout).toContain('Connected Git Providers');
    expect(ensureServerMock).toHaveBeenCalled();
  });

  it('lists self-hosted integrations alongside cloud providers', async () => {
    const { loadSettings, getDatabasePath } = await import('../../../shared/config');
    const { CapaDatabase } = await import('../../../db/database');
    const settings = await loadSettings();
    const db = new CapaDatabase(getDatabasePath(settings));
    try {
      db.setGitIntegration('github', {
        access_token: 'gh',
        token_type: 'token',
      });
      db.setGitIntegration('github-enterprise', {
        host: 'git.corp.com',
        access_token: 'ghe',
        token_type: 'token',
      });
    } finally {
      db.close();
    }

    const { stdout } = await captureOutput(() => authCommand());
    expect(stdout).toContain('github.com');
    expect(stdout).toContain('GitHub Enterprise (git.corp.com)');
  });

  it('exits with a clear error for an invalid provider format', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
    const { stdout } = await captureOutput(() => authCommand('not-a-valid-domain'));
    expect(stdout).toContain('Invalid provider');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits with a clear error for an unknown git provider', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
    const { stdout } = await captureOutput(() => authCommand('example.com'));
    expect(stdout).toContain('Unknown git provider: example.com');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  describe('access-token path', () => {
    const originalFetch = globalThis.fetch;
    let fetchOk = true;

    beforeEach(() => {
      fetchOk = true;
      globalThis.fetch = (async () =>
        new Response(fetchOk ? JSON.stringify({ login: 'u' }) : 'Unauthorized', {
          status: fetchOk ? 200 : 401,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('stores a cloud GitHub token without starting the server', async () => {
      const { stdout } = await captureOutput(() =>
        authCommand('github.com', { accessToken: 'ghp_test' }),
      );

      expect(ensureServerMock).not.toHaveBeenCalled();
      expect(stdout).toContain('Authenticated with github.com using access token');

      const { loadSettings, getDatabasePath } = await import('../../../shared/config');
      const { CapaDatabase } = await import('../../../db/database');
      const settings = await loadSettings();
      const db = new CapaDatabase(getDatabasePath(settings));
      try {
        const stored = db.getGitIntegration('github');
        expect(stored?.access_token).toBe('ghp_test');
        expect(stored?.host).toBeNull();
      } finally {
        db.close();
      }
    });

    it('stores a self-hosted token when --type is provided', async () => {
      const { stdout } = await captureOutput(() =>
        authCommand('git.corp.com', {
          accessToken: 'ghe_test',
          type: 'github-enterprise',
        }),
      );

      expect(ensureServerMock).not.toHaveBeenCalled();
      expect(stdout).toContain('Authenticated with git.corp.com using access token');

      const { loadSettings, getDatabasePath } = await import('../../../shared/config');
      const { CapaDatabase } = await import('../../../db/database');
      const settings = await loadSettings();
      const db = new CapaDatabase(getDatabasePath(settings));
      try {
        const stored = db.getGitIntegration('github-enterprise', 'git.corp.com');
        expect(stored?.access_token).toBe('ghe_test');
      } finally {
        db.close();
      }
    });

    it('requires --type for unknown self-hosted hosts', async () => {
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
      const { stdout } = await captureOutput(() =>
        authCommand('git.corp.com', { accessToken: 'tok' }),
      );
      expect(stdout).toContain('--type');
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('rejects --type on cloud hosts', async () => {
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
      const { stdout } = await captureOutput(() =>
        authCommand('github.com', {
          accessToken: 'tok',
          type: 'github-enterprise',
        }),
      );
      expect(stdout).toContain('--type is not needed');
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('exits when the token is invalid', async () => {
      fetchOk = false;
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
      const { stdout } = await captureOutput(() =>
        authCommand('github.com', { accessToken: 'bad' }),
      );
      expect(stdout).toContain('Invalid Personal Access Token');
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  afterAll(() => {
    mock.restore();
  });
});
