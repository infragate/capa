import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getServerStatus, stopServer } from '../utils/server-manager';
import {
  header,
  footer,
  success,
  info,
  error,
  isYes,
  isInteractive,
  prompt,
} from '../ui';
import {
  assertSha256Match,
  formatUpgradePreview,
  githubFetchBytes,
  githubFetchText,
  planUpgrade,
  sha256Hex,
  upgradeConfirmationState,
  type UpgradePlan,
} from './upgrade-plan';

export async function upgradeCommand(): Promise<void> {
  header('Upgrade capa');

  let plan: UpgradePlan;
  try {
    plan = await planUpgrade({ fetchText: githubFetchText });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  for (const line of formatUpgradePreview(plan).split('\n')) {
    info(line);
  }

  try {
    const decision = upgradeConfirmationState({
      yes: isYes(),
      interactive: isInteractive(),
    });
    if (decision === 'prompt') {
      const ok = await prompt.confirm(
        'Download and run this verified installer?',
        false,
      );
      if (!ok) {
        error('Upgrade cancelled.');
        process.exit(1);
      }
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let installerBytes: Uint8Array;
  try {
    installerBytes = await githubFetchBytes(plan.installerUrl);
    assertSha256Match(
      sha256Hex(installerBytes),
      plan.installerDigest,
      plan.installerAsset,
    );
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const status = await getServerStatus();
  if (status.running) {
    info('Stopping running server…');
    await stopServer();
  }

  const dir = mkdtempSync(join(tmpdir(), 'capa-upgrade-'));
  const installerPath = join(dir, plan.installerAsset);
  writeFileSync(installerPath, Buffer.from(installerBytes));
  if (process.platform !== 'win32') {
    chmodSync(installerPath, 0o755);
  }

  const env = {
    ...process.env,
    CAPA_VERSION: plan.version,
  };

  if (process.platform === 'win32') {
    const proc = Bun.spawn(
      [
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
      ],
      {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
        detached: true,
        env,
      },
    );
    proc.unref();
    success(
      'Verified installer started. This window will close; capa will update in the background.',
    );
    info(
      'Restart your terminal when the installer finishes, then run `capa --version` to confirm.',
    );
    process.exit(0);
  }

  const proc = Bun.spawn(['bash', installerPath], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    error('Upgrade failed');
    process.exit(exitCode ?? 1);
  }

  footer('Upgrade complete');
}
