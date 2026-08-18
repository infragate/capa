import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import {
  ensureMirrorClone,
  fetchMirror,
  getRepoMirrorDir,
} from '../cache';

const execFileAsync = promisify(childProcess.execFile);

const SECRET = 'gho_F10_SUPER_SECRET_TOKEN';

const noAuthFetch = {
  hasAuth: () => false,
  getTokenForUrl: () => null,
} as any;

const authFetch = {
  hasAuth: (url: string) => /github\.com/i.test(url),
  getTokenForUrl: (url: string) => (/github\.com/i.test(url) ? SECRET : null),
} as any;

function argvContainsSecret(args: string[]): boolean {
  return args.some((a) => a.includes(SECRET));
}

function envCarriesOutOfBandAuth(env: NodeJS.ProcessEnv | undefined): boolean {
  if (!env) return false;
  if (env.GIT_ASKPASS) return true;
  if (env.GIT_CONFIG_COUNT && Number.parseInt(env.GIT_CONFIG_COUNT, 10) > 0) {
    return Object.entries(env).some(
      ([k, v]) => k.startsWith('GIT_CONFIG_') && typeof v === 'string' && (
        v.includes(SECRET) ||
        v.includes(Buffer.from(`oauth2:${SECRET}`, 'utf8').toString('base64')) ||
        v.toLowerCase().includes('authorization')
      ),
    );
  }
  return Object.values(env).some(
    (v) => typeof v === 'string' && v.includes(SECRET),
  );
}

describe('cache git auth (F10)', () => {
  let cacheRoot: string;
  let prevCacheDir: string | undefined;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'capa-git-auth-'));
    prevCacheDir = process.env.CAPA_CACHE_DIR;
    process.env.CAPA_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    if (prevCacheDir === undefined) {
      delete process.env.CAPA_CACHE_DIR;
    } else {
      process.env.CAPA_CACHE_DIR = prevCacheDir;
    }
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  describe('ensureMirrorClone', () => {
    it('does not put the oauth token in git clone argv', async () => {
      const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
        ((_cmd: string, args: string[], opts: object, cb: (err: null, stdout: string, stderr: string) => void) => {
          calls.push({ args, env: (opts as { env?: NodeJS.ProcessEnv }).env });
          cb(null, '', '');
        }) as typeof childProcess.execFile,
      );

      try {
        await ensureMirrorClone('github', 'owner/repo', authFetch);
        const cloneCall = calls.find((c) => c.args.includes('clone'));
        expect(cloneCall).toBeDefined();
        expect(argvContainsSecret(cloneCall!.args)).toBe(false);
        expect(cloneCall!.args.some((a) => /oauth2:/i.test(a))).toBe(false);
        expect(cloneCall!.args).toContain('https://github.com/owner/repo.git');
      } finally {
        execFileSpy.mockRestore();
      }
    });

    it('injects private-clone credentials out of band via GIT_ASKPASS or GIT_CONFIG env', async () => {
      const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
        ((_cmd: string, args: string[], opts: object, cb: (err: null, stdout: string, stderr: string) => void) => {
          calls.push({ args, env: (opts as { env?: NodeJS.ProcessEnv }).env });
          cb(null, '', '');
        }) as typeof childProcess.execFile,
      );

      try {
        await ensureMirrorClone('github', 'owner/repo', authFetch);
        const cloneCall = calls.find((c) => c.args.includes('clone'));
        expect(cloneCall).toBeDefined();
        expect(argvContainsSecret(cloneCall!.args)).toBe(false);
        expect(envCarriesOutOfBandAuth(cloneCall!.env)).toBe(true);
      } finally {
        execFileSpy.mockRestore();
      }
    });

    it('stores remote.origin.url without userinfo after clone', async () => {
      const realExecFile = childProcess.execFile.bind(childProcess);
      const argvLog: string[][] = [];
      const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
        ((cmd: string, args: string[], opts: object, cb: (...cbArgs: unknown[]) => void) => {
          argvLog.push(args);
          expect(argvContainsSecret(args)).toBe(false);

          if (args.includes('clone') && args.includes('--mirror')) {
            const dest = args[args.length - 1];
            const url = args[args.length - 2];
            mkdirSync(dest, { recursive: true });
            realExecFile('git', ['init', '--bare', dest], { windowsHide: true }, (err) => {
              if (err) return cb(err);
              realExecFile(
                'git',
                ['-C', dest, 'remote', 'add', 'origin', url],
                { windowsHide: true },
                cb as (...cbArgs: unknown[]) => void,
              );
            });
            return;
          }

          return realExecFile(cmd, args, opts, cb as (...cbArgs: unknown[]) => void);
        }) as typeof childProcess.execFile,
      );

      try {
        const mirrorDir = await ensureMirrorClone('github', 'owner/repo', authFetch);
        const { stdout } = await execFileAsync('git', [
          '-C',
          mirrorDir,
          'config',
          '--get',
          'remote.origin.url',
        ]);
        const remoteUrl = stdout.trim();
        expect(remoteUrl).toBe('https://github.com/owner/repo.git');
        expect(remoteUrl).not.toContain(SECRET);
        expect(remoteUrl).not.toMatch(/oauth2:/i);
        expect(argvLog.some((a) => a.includes('set-url'))).toBe(true);
      } finally {
        execFileSpy.mockRestore();
      }
    });

    it('does not inject auth env for public clones', async () => {
      const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
        ((_cmd: string, args: string[], opts: object, cb: (err: null, stdout: string, stderr: string) => void) => {
          calls.push({ args, env: (opts as { env?: NodeJS.ProcessEnv }).env });
          cb(null, '', '');
        }) as typeof childProcess.execFile,
      );

      try {
        await ensureMirrorClone('github', 'owner/repo', noAuthFetch);
        const cloneCall = calls.find((c) => c.args.includes('clone'));
        expect(cloneCall).toBeDefined();
        expect(cloneCall!.args).toContain('https://github.com/owner/repo.git');
        expect(JSON.stringify(cloneCall!.env ?? {})).not.toContain(SECRET);
        expect(cloneCall!.args.some((a) => /oauth2:/i.test(a))).toBe(false);
      } finally {
        execFileSpy.mockRestore();
      }
    });
  });

  describe('fetchMirror', () => {
    it('injects credentials per call without putting the token in argv', async () => {
      const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
        ((_cmd: string, args: string[], opts: object, cb: (err: null, stdout: string, stderr: string) => void) => {
          calls.push({ args, env: (opts as { env?: NodeJS.ProcessEnv }).env });
          if (args.includes('get-url')) {
            cb(null, 'https://github.com/owner/repo.git\n', '');
            return;
          }
          cb(null, '', '');
        }) as typeof childProcess.execFile,
      );

      try {
        await fetchMirror(join(cacheRoot, 'dummy-mirror'), authFetch);
        const updateCall = calls.find((c) => c.args.includes('update'));
        expect(updateCall).toBeDefined();
        expect(argvContainsSecret(updateCall!.args)).toBe(false);
        expect(updateCall!.args.some((a) => /oauth2:/i.test(a))).toBe(false);
        expect(envCarriesOutOfBandAuth(updateCall!.env)).toBe(true);
      } finally {
        execFileSpy.mockRestore();
      }
    });
  });

  describe('mirror config migration', () => {
    it('scrubs oauth2 userinfo from a cached mirror config', async () => {
      const mirrorDir = getRepoMirrorDir('github', 'org/repo');
      mkdirSync(mirrorDir, { recursive: true });
      writeFileSync(
        join(mirrorDir, 'config'),
        `[core]
	bare = true
[remote "origin"]
	url = https://oauth2:${SECRET}@github.com/org/repo.git
	fetch = +refs/*:refs/*
`,
      );

      await ensureMirrorClone('github', 'org/repo', noAuthFetch);

      expect(existsSync(join(mirrorDir, 'config'))).toBe(true);
      const config = readFileSync(join(mirrorDir, 'config'), 'utf8');
      expect(config).not.toContain(SECRET);
      expect(config).not.toMatch(/oauth2:/i);
      expect(config).toContain('https://github.com/org/repo.git');
    });
  });
});
