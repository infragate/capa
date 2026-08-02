import { spawnSync } from 'node:child_process';
import type { WrapLaunchConfig } from '../../../types/providers';

export interface LaunchResult {
  /** Exit code for CLI providers after they exit. */
  exitCode?: number;
  /**
   * GUI: resolves when the app process exits (e.g. Cursor with `--wait`
   * after the window is closed).
   */
  closed?: Promise<number>;
  /** GUI: terminate the launcher/app process (e.g. on Ctrl+C). */
  kill?: () => void;
}

/**
 * Quiesce parent stdin so Bun races the child less for console keystrokes.
 *
 * Do NOT destroy/close fd 0 — that breaks `stdio: 'inherit'` and makes Claude
 * see a non-TTY (it then demands `--print` + a prompt).
 */
function releaseStdinForChild(): void {
  const stdin = process.stdin;
  try {
    if (typeof stdin.setRawMode === 'function' && stdin.isTTY) {
      stdin.setRawMode(false);
    }
  } catch {
    // ignore
  }
  try {
    stdin.pause();
  } catch {
    // ignore
  }
  try {
    stdin.removeAllListeners('data');
    stdin.removeAllListeners('readable');
    stdin.removeAllListeners('keypress');
  } catch {
    // ignore
  }
  try {
    stdin.unref();
  } catch {
    // ignore
  }

  if (process.stdout.isTTY) {
    try {
      process.stdout.write('\x1b[?25h');
    } catch {
      // ignore
    }
  }
}

/**
 * Headroom's wrap pattern: parent ignores SIGINT so Ctrl+C is for the child
 * CLI, not the wrap process.
 */
function ignoreParentSigint(): () => void {
  const noop = () => {
    // Child owns the console; do not exit wrap on Ctrl+C.
  };
  process.on('SIGINT', noop);
  return () => {
    process.off('SIGINT', noop);
  };
}

/**
 * Launch according to wrap.kind.
 * CLI: blocking spawnSync with inherited console (real TTY for Claude).
 * GUI: returns immediately with `closed`/`kill` so wrap can race window-close vs interrupt.
 */
export async function launchProvider(
  wrap: WrapLaunchConfig,
  workspacePath: string,
  args: string[],
): Promise<LaunchResult> {
  const wrapArgs = wrap.args ?? [];

  if (wrap.kind === 'gui') {
    const proc = Bun.spawn([wrap.binary, ...wrapArgs, workspacePath, ...args], {
      cwd: workspacePath,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
    });

    return {
      closed: proc.exited.then((code) => code ?? 0),
      kill: () => {
        try {
          proc.kill();
        } catch {
          // already exited
        }
      },
    };
  }

  // CLI interactive TUI: inherit the real console so isTTY stays true.
  // spawnSync blocks this thread; watchers run in a detached __wrap_watch__
  // process so we are not also polling stdin from an in-process event loop.
  releaseStdinForChild();
  const restoreSigint = ignoreParentSigint();

  try {
    // Windows CLI shims are often `.cmd`/`.ps1` (e.g. Cursor's `agent`).
    // spawnSync without a shell only resolves real executables, so enable
    // shell on win32 — same pattern as native plugin install.
    const result = spawnSync(wrap.binary, [...wrapArgs, ...args], {
      cwd: workspacePath,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
      shell: process.platform === 'win32',
    });

    if (result.error) {
      throw result.error;
    }

    const exitCode =
      result.status != null ? result.status : result.signal != null ? 128 : 1;
    return { exitCode };
  } finally {
    restoreSigint();
  }
}
