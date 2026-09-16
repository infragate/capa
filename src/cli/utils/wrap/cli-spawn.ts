/**
 * Build the spawn call for a wrapped provider CLI.
 *
 * On Windows, provider CLIs are either real executables (`claude.exe`) or
 * `.cmd` / `.bat` shims (e.g. Cursor's `agent`). `spawnSync` without a shell
 * cannot run shims, but `shell: true` joins arguments with plain spaces, so
 * `capa wrap claude -p "fix the bug"` reached Claude as `-p fix the bug`.
 *
 * Executables are spawned directly. Shims go through `cmd.exe` with every
 * argument quoted and escaped (same algorithm as cross-spawn).
 */

export interface CliSpawn {
  command: string;
  args: string[];
  shell: boolean;
}

// See http://www.robvanderwoude.com/escapechars.php
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

export function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META_CHARS, '^$1');
}

export function escapeCmdArgument(arg: string, doubleEscapeMetaChars = false): string {
  // Based on https://qntm.org/cmd: backslashes before a quote or the closing
  // quote are doubled, embedded quotes are escaped, then cmd meta chars are
  // caret-escaped.
  let escaped = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(CMD_META_CHARS, '^$1');
  if (doubleEscapeMetaChars) escaped = escaped.replace(CMD_META_CHARS, '^$1');
  return escaped;
}

export function resolveCliSpawn(
  binary: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): CliSpawn {
  if (platform !== 'win32') {
    return { command: binary, args, shell: false };
  }

  const resolved = which(binary) ?? binary;
  if (!/\.(cmd|bat)$/i.test(resolved)) {
    return { command: resolved, args, shell: false };
  }

  // npm-style shims under node_modules/.bin re-parse their arguments once more.
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved);
  const line = [
    escapeCmdCommand(resolved),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscape)),
  ].join(' ');
  return { command: line, args: [], shell: true };
}
