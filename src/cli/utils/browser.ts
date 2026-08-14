import { spawn } from 'node:child_process';

/**
 * Launch the user's default browser at `url` without ever blocking the caller.
 *
 * CAPA was originally written for a developer's local machine, where the old
 * implementation `await`ed the opener process (`xdg-open`/`open`). On many
 * Linux setups the opener stays attached to the browser it launches, so
 * awaiting it blocks until that browser window is closed. In a cloud agent
 * sandbox that has a display but no human (for example a VNC-backed CI/agent
 * VM), this hangs commands such as `capa install` indefinitely.
 *
 * We now spawn the opener fully detached and never wait on it. The promise
 * resolves with `true` when the opener was spawned without an immediate error,
 * or `false` otherwise. Callers should still consult `canLaunchBrowser()`
 * (see ./environment) before attempting a launch where no browser exists.
 */
export function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;

  let command: string;
  let args: string[];
  if (platform === 'win32') {
    // `start` is a cmd.exe builtin; the empty title argument keeps a quoted
    // URL from being mis-parsed as the window title.
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
      child.once('error', () => settle(false));
      // Detach so the browser's lifetime is fully independent of this process:
      // the opener can neither block us nor be killed when the CLI exits.
      child.unref();
      // Resolve on the next tick. We intentionally never await the opener.
      const timer = setTimeout(() => settle(true), 50);
      if (typeof timer.unref === 'function') timer.unref();
    } catch {
      settle(false);
    }
  });
}
