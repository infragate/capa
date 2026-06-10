import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { LFS_SKIP_ARGS, gitCommandArgs, git } from '../git-cli';

describe('git-cli', () => {
  it('prepends LFS skip flags on clone --mirror', () => {
    expect(gitCommandArgs(['clone', '--mirror', 'https://example.com/repo.git', '/tmp/mirror'])).toEqual([
      ...LFS_SKIP_ARGS,
      'clone',
      '--mirror',
      'https://example.com/repo.git',
      '/tmp/mirror',
    ]);
  });

  it('prepends LFS skip flags on worktree add', () => {
    const args = gitCommandArgs([
      '-C',
      '/tmp/mirror',
      'worktree',
      'add',
      '--detach',
      '--force',
      '/tmp/snap',
      'abc123',
    ]);
    expect(args.slice(0, 8)).toEqual(LFS_SKIP_ARGS);
    expect(args).toContain('worktree');
    expect(args).toContain('add');
  });

  it('passes windowsHide: true to execFile so git subprocesses never flash a console on Windows', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: string[], opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        expect((opts as { windowsHide?: boolean }).windowsHide).toBe(true);
        cb(null, { stdout: '', stderr: '' });
      }) as typeof childProcess.execFile
    );

    await git(['version']);
    expect(execFileSpy).toHaveBeenCalled();
    execFileSpy.mockRestore();
  });

  it('runs git non-interactively so a missing credential never hangs the install', async () => {
    let capturedEnv: Record<string, string | undefined> = {};
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: string[], opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        capturedEnv = (opts as { env?: Record<string, string | undefined> }).env ?? {};
        cb(null, { stdout: '', stderr: '' });
      }) as typeof childProcess.execFile
    );

    await git(['clone', '--mirror', 'https://github.com/owner/private.git', '/tmp/m']);

    // The actual fix: git must not fall back to an interactive prompt.
    expect(capturedEnv.GIT_TERMINAL_PROMPT).toBe('0');
    expect(capturedEnv.GCM_INTERACTIVE).toBe('never');
    expect(capturedEnv.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    // Existing behaviour preserved.
    expect(capturedEnv.GIT_LFS_SKIP_SMUDGE).toBe('1');

    execFileSpy.mockRestore();
  });

  it('lets a caller-provided env override the non-interactive defaults', async () => {
    let capturedEnv: Record<string, string | undefined> = {};
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: string[], opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        capturedEnv = (opts as { env?: Record<string, string | undefined> }).env ?? {};
        cb(null, { stdout: '', stderr: '' });
      }) as typeof childProcess.execFile
    );

    await git(['version'], { env: { GIT_TERMINAL_PROMPT: '1' } });
    expect(capturedEnv.GIT_TERMINAL_PROMPT).toBe('1');

    execFileSpy.mockRestore();
  });
});
