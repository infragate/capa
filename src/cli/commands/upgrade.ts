import { getServerStatus, stopServer } from '../utils/server-manager';
import { header, footer, success, info, error, runTasks } from '../ui';
import type { Task } from '../ui';

const INSTALL_SH_URL = 'https://capa.infragate.ai/install.sh';
const INSTALL_PS1_URL = 'https://capa.infragate.ai/install.ps1';

export async function upgradeCommand(): Promise<void> {
  header('Upgrade capa');

  const tasks: Task[] = [
    {
      title: 'Stop running server',
      task: async () => {
        const status = await getServerStatus();
        if (status.running) {
          await stopServer();
        }
      },
    },
    {
      title:
        process.platform === 'win32'
          ? 'Start Windows installer'
          : 'Run installation script',
      task: async () => {
        if (process.platform === 'win32') {
          await runWindowsInstaller();
        } else {
          await runUnixInstaller();
        }
      },
    },
  ];

  await runTasks(tasks);
  footer('Upgrade complete');
}

async function runWindowsInstaller(): Promise<void> {
  const proc = Bun.spawn(
    [
      'powershell.exe',
      '-ExecutionPolicy',
      'Bypass',
      '-NoProfile',
      '-Command',
      `irm '${INSTALL_PS1_URL}' | iex`,
    ],
    {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
      detached: true,
      env: { ...process.env },
    },
  );
  proc.unref();

  success(
    'Installer started. This window will close; the installer will update capa in the background.',
  );
  info('Restart your terminal when the installer finishes, then run `capa --version` to confirm.');
  process.exit(0);
}

async function runUnixInstaller(): Promise<void> {
  const hasCurl = await commandExists('curl');
  const cmd = hasCurl
    ? `curl -fsSL '${INSTALL_SH_URL}' | sh`
    : `wget -qO- '${INSTALL_SH_URL}' | sh`;

  if (!hasCurl && !(await commandExists('wget'))) {
    error('Neither curl nor wget is available. Please install one and try again.');
    error(`Or run the installation script manually: ${INSTALL_SH_URL}`);
    process.exit(1);
  }

  const proc = Bun.spawn(['sh', '-c', cmd], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    error('Upgrade failed');
    process.exit(exitCode ?? 1);
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
