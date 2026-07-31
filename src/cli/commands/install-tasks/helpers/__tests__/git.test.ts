import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { checkGitInstalled } from '../git';

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
