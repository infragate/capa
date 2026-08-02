import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { ensureWrapBinaryOnPath } from '../wrap-ensure-binary';

describe('ensureWrapBinaryOnPath', () => {
  it('resolves when the binary is on PATH', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: readonly string[] | null | undefined, _opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: '/usr/bin/gemini\n', stderr: '' });
      }) as typeof childProcess.execFile,
    );

    await ensureWrapBinaryOnPath('gemini', 'gemini-cli');
    expect(execFileSpy).toHaveBeenCalled();
    const [, args] = execFileSpy.mock.calls[0] as unknown as [string, string[]];
    expect(args).toEqual(['gemini']);
    execFileSpy.mockRestore();
  });

  it('rejects with a wrap-specific message when missing', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: readonly string[] | null | undefined, _opts: object, cb: (err: Error) => void) => {
        cb(new Error('not found'));
      }) as typeof childProcess.execFile,
    );

    await expect(ensureWrapBinaryOnPath('gemini', 'gemini-cli')).rejects.toThrow(
      'gemini not found — required by capa wrap gemini-cli',
    );
    execFileSpy.mockRestore();
  });
});
