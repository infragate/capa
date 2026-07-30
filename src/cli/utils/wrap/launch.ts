import { spawn } from 'node:child_process';
import type { ProviderIntegration } from '../../../types/providers';

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
 * Stop capa from competing with the child for console input.
 *
 * Bun keeps polling fd 0 after anything touches `process.stdin` (e.g. clack
 * spinners during cold install). A child spawned with stdio inherit then races
 * the parent for keystrokes — Claude's TUI looks "broken". Pause/unref first.
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

  // Spinner may have hidden the cursor; restore before handing off the TTY.
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
 * CLI, not the wrap process (watchers stay alive until the child exits).
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
 * Launch the provider binary according to wrap.kind.
 * CLI: blocking, cwd = workspace.
 * GUI: returns immediately with `closed`/`kill` so wrap can race window-close vs interrupt.
 */
export async function launchProvider(
  provider: ProviderIntegration,
  workspacePath: string,
  args: string[],
): Promise<LaunchResult> {
  const wrap = provider.wrap;
  if (!wrap) {
    throw new Error(`Provider "${provider.id}" is not wrappable.`);
  }

  const wrapArgs = wrap.args ?? [];

  if (wrap.kind === 'gui') {
    // Prefer awaiting the GUI launcher (Cursor/VS Code `--wait`) so closing the
    // window ends wrap. Not detached — we need the process lifetime.
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

  // CLI: mirror Headroom (`subprocess.run(..., inherit stdio)`), not Bun.spawn.
  // node:child_process + released stdin is far more reliable for interactive TUIs
  // under a Bun-compiled parent (Claude Code, Codex, etc.).
  releaseStdinForChild();
  const restoreSigint = ignoreParentSigint();

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(wrap.binary, [...wrapArgs, ...args], {
        cwd: workspacePath,
        env: process.env,
        stdio: 'inherit',
        windowsHide: false,
        shell: false,
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code, signal) => {
        if (code != null) {
          resolve(code);
          return;
        }
        // Signal exit without a code (POSIX); map roughly like a shell would.
        resolve(signal ? 128 : 1);
      });
    });

    return { exitCode };
  } finally {
    restoreSigint();
  }
}
