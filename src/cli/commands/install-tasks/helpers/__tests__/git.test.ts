import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { checkGitInstalled, explainGitError } from '../git';

describe('explainGitError', () => {
  it("keeps the cache's own messages instead of reporting an unknown clone error", () => {
    for (const message of [
      'Invalid version "main@{1}": use a tag, branch or commit SHA',
      'Invalid pinned commit "main" in capabilities.lock: expected a commit SHA.',
      'Tag/branch "v9.9.9" not found in repository at /cache/x',
    ]) {
      for (const platform of ['github', 'git'] as const) {
        expect(explainGitError(new Error(message), platform, 'o/r', false, 'https://h/o/r.git').message).toBe(message);
      }
    }
  });

  it('still explains a failed git process', () => {
    const failed = Object.assign(new Error('Command failed: git clone\nfatal: unable to access host'), { cmd: 'git clone', code: 128 });
    expect(explainGitError(failed, 'github', 'o/r', false).message).toMatch(/^Network error/);
    const spawn = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    expect(explainGitError(spawn, 'git', 'o/r', false, 'https://h/o/r.git').message).toMatch(/^Git is not installed/);
  });
});

describe('checkGitInstalled', () => {
  it('passes windowsHide: true so git --version never flashes a console on Windows', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: readonly string[] | null | undefined, opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        expect((opts as { windowsHide?: boolean }).windowsHide).toBe(true);
        cb(null, { stdout: 'git version 2.0.0\n', stderr: '' });
      }) as typeof childProcess.execFile,
    );

    await expect(checkGitInstalled()).resolves.toBe(true);
    expect(execFileSpy).toHaveBeenCalled();
    execFileSpy.mockRestore();
  });
});
