import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { escapeCmdArgument, resolveCliSpawn } from '../cli-spawn';

describe('resolveCliSpawn', () => {
  const args = ['-p', 'fix the bug', '--flag'];

  it('spawns directly on non-Windows platforms', () => {
    expect(resolveCliSpawn('claude', args, 'linux', () => '/usr/bin/claude')).toEqual({
      command: 'claude',
      args,
      shell: false,
    });
  });

  it('spawns a resolved Windows executable without a shell, keeping args intact', () => {
    expect(
      resolveCliSpawn('claude', args, 'win32', () => 'C:\\Users\\A B\\bin\\claude.exe'),
    ).toEqual({ command: 'C:\\Users\\A B\\bin\\claude.exe', args, shell: false });
  });

  it('runs .cmd shims through cmd with each argument quoted', () => {
    const spawn = resolveCliSpawn('agent', args, 'win32', () => 'C:\\tools\\agent.cmd');
    expect(spawn.shell).toBe(true);
    expect(spawn.args).toEqual([]);
    expect(spawn.command).toBe('C:\\tools\\agent.cmd ^"-p^" ^"fix^ the^ bug^" ^"--flag^"');
  });

  it('escapes quotes, backslashes and cmd metacharacters', () => {
    expect(escapeCmdArgument('a "b" & c')).toBe('^"a^ \\^"b\\^"^ ^&^ c^"');
    expect(escapeCmdArgument('C:\\dir\\')).toBe('^"C:\\dir\\\\^"');
  });

  const onWindows = process.platform === 'win32' ? it : it.skip;
  onWindows('round-trips tricky arguments through a real .cmd shim and executable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capa-cli-spawn-'));
    try {
      const out = join(dir, 'argv.json');
      const script = join(dir, 'print-args.js');
      writeFileSync(
        script,
        `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`,
      );
      const shim = join(dir, 'print args.cmd');
      writeFileSync(shim, `@"${process.execPath}" "${script}" %*\r\n`);
      const tricky = ['-p', 'fix the bug', 'say "hi" & exit', '100%', 'a^b', 'path\\', ''];

      for (const binary of [shim, process.execPath]) {
        const argv = binary === process.execPath ? [script, ...tricky] : tricky;
        const spawn = resolveCliSpawn(binary, argv, 'win32', (b) => b);
        const result = spawnSync(spawn.command, spawn.args, { shell: spawn.shell, stdio: 'ignore' });
        expect(result.status).toBe(0);
        expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(tricky);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
