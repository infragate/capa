import { getServerStatus, stopServer } from '../utils/server-manager';

const INSTALL_SH_URL = 'https://capa.infragate.ai/install.sh';
const INSTALL_PS1_URL = 'https://capa.infragate.ai/install.ps1';

export async function upgradeCommand(): Promise<void> {
  console.log('Upgrading capa...\n');

  const status = await getServerStatus();
  if (status.running) {
    await stopServer();
    console.log('');
  }

  if (process.platform === 'win32') {
    await upgradeWindows();
  } else {
    await upgradeUnix();
  }
}

async function upgradeWindows(): Promise<void> {
  console.log('Starting Windows installer in the background...\n');

  // Spawn the installer detached and exit immediately so this process (capa.exe) is
  // no longer running when the script tries to replace the binary (fixes #19).
  const proc = Bun.spawn(
    ['powershell.exe', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', `irm '${INSTALL_PS1_URL}' | iex`],
    {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
      detached: true,
      env: { ...process.env },
    }
  );
  proc.unref();

  console.log('✓ Installer started. This window will close; the installer will update capa in the background.');
  console.log('  Restart your terminal when the installer finishes, then run `capa --version` to confirm.\n');
  process.exit(0);
}

async function upgradeUnix(): Promise<void> {
  console.log('Running installation script...\n');

  const hasCurl = await commandExists('curl');
  const cmd = hasCurl
    ? `curl -fsSL '${INSTALL_SH_URL}' | sh`
    : `wget -qO- '${INSTALL_SH_URL}' | sh`;

  if (!hasCurl && !(await commandExists('wget'))) {
    console.error('✗ Neither curl nor wget is available. Please install one and try again.');
    console.error(`  Or run the installation script manually: ${INSTALL_SH_URL}`);
    process.exit(1);
  }

  const proc = Bun.spawn(['sh', '-c', cmd], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error('\n✗ Upgrade failed');
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
