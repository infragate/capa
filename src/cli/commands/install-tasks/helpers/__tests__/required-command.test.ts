import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { checkRequiredCommand } from '../required-command';

describe('checkRequiredCommand', () => {
  it('passes windowsHide: true so PATH checks never flash a console on Windows', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      ((_cmd: string, _args: readonly string[] | null | undefined, opts: object, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        expect((opts as { windowsHide?: boolean }).windowsHide).toBe(true);
        cb(null, { stdout: 'C:\\fake\\cli.exe\n', stderr: '' });
      }) as typeof childProcess.execFile,
    );

    await checkRequiredCommand({ cli: 'git' });
    expect(execFileSpy).toHaveBeenCalled();
    const [bin, args] = execFileSpy.mock.calls[0] as unknown as [string, string[]];
    expect(bin).toBe(process.platform === 'win32' ? 'where' : 'which');
    expect(args).toEqual(['git']);
    execFileSpy.mockRestore();
  });

  it('rejects invalid CLI names before spawning', async () => {
    const execFileSpy = spyOn(childProcess, 'execFile').mockImplementation(
      (() => {
        throw new Error('should not spawn');
      }) as unknown as typeof childProcess.execFile,
    );

    expect(checkRequiredCommand({ cli: 'git; rm -rf /' })).rejects.toThrow(/Invalid command name/);
    expect(execFileSpy).not.toHaveBeenCalled();
    execFileSpy.mockRestore();
  });
});
