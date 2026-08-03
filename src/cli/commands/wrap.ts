import { resolve } from 'path';
import {
  formatWrappableProviderList,
  resolveWrapTarget,
} from '../../shared/providers';
import { prepareWorkspace, pruneWorkspaces } from '../utils/wrap/workspace';
import { startWrapWatchers } from '../utils/wrap/watch-project';
import { launchProvider } from '../utils/wrap/launch';
import { waitForInterrupt } from '../utils/wrap/wait-for-interrupt';
import { clearWrapSession, writeWrapSession } from '../utils/wrap/session-file';
import { ensureWrapBinaryOnPath } from './wrap-ensure-binary';
import { ensureWrapServerRunning } from './wrap-ensure-server';
import { resolveWrapProviderArg } from './wrap-prompt';
import { info, error } from '../ui';

export interface WrapOptions {
  project?: string;
  printDir?: boolean;
  prune?: boolean;
}

function startDetachedWatchWorker(opts: {
  realProjectPath: string;
  workspacePath: string;
  providerId: string;
  capabilitiesPath: string;
  exclusionProviderIds: string[];
}): { pid?: number; stop: () => void } {
  const proc = Bun.spawn(
    [
      process.execPath,
      '__wrap_watch__',
      opts.realProjectPath,
      opts.workspacePath,
      opts.providerId,
      opts.capabilitiesPath,
      JSON.stringify(opts.exclusionProviderIds),
    ],
    {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      detached: true,
      windowsHide: true,
    },
  );
  proc.unref();

  return {
    pid: proc.pid,
    stop: () => {
      if (proc.pid == null) return;
      try {
        process.kill(proc.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(proc.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    },
  };
}

export async function wrapCommand(
  providerArg: string | undefined,
  args: string[],
  options: WrapOptions = {},
): Promise<void> {
  if (options.prune) {
    const n = await pruneWorkspaces();
    info(`Pruned ${n} wrap workspace(s).`);
    return;
  }

  let providerToken: string;
  try {
    providerToken = await resolveWrapProviderArg(providerArg);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const target = resolveWrapTarget(providerToken);
  if (!target) {
    const available = formatWrappableProviderList();
    error(
      `Unknown or non-wrappable provider "${providerToken}".\n` +
        `  Available: ${available || '(none)'}`,
    );
    process.exit(1);
  }

  const { provider, wrap } = target;

  // Fail fast before shadow workspace install when the launch binary is missing.
  try {
    await ensureWrapBinaryOnPath(wrap.binary, providerToken);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Warm wrap reuses the shadow workspace without install — still need the
  // server for MCP tools, capa sh, and activity/telemetry hooks.
  try {
    await ensureWrapServerRunning();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const realProjectPath = resolve(options.project ?? process.cwd());

  let prepared;
  try {
    prepared = await prepareWorkspace(realProjectPath, provider);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (options.printDir) {
    console.log(prepared.workspacePath);
  }

  info(
    prepared.cold
      ? `Created wrap workspace for ${provider.displayName}`
      : prepared.installed
        ? `Updated wrap workspace for ${provider.displayName} (capabilities changed)`
        : `Reusing wrap workspace for ${provider.displayName}`,
  );
  info(prepared.workspacePath);

  if (!writeWrapSession(prepared.cachePath, {
    pid: process.pid,
    realProjectPath: prepared.realProjectPath,
    workspacePath: prepared.workspacePath,
  })) {
    console.warn('⚠ Could not write wrap session file; clean/delete may not stop this session.');
  }

  if (wrap.kind === 'gui') {
    const watchers = startWrapWatchers({
      realProjectPath: prepared.realProjectPath,
      workspacePath: prepared.workspacePath,
      providerId: provider.id,
      capabilitiesPath: prepared.capabilitiesPath,
      exclusionProviderIds: prepared.exclusionProviderIds,
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      watchers.exitSweep();
      watchers.stop();
      clearWrapSession(prepared.cachePath);
    };

    const onStopSignal = () => {
      cleanup();
      process.exit(0);
    };
    process.once('SIGTERM', onStopSignal);
    try {
      process.once('SIGHUP', onStopSignal);
    } catch {
      // Windows
    }

    info(
      `Launching ${wrap.binary} (wrap stops when the window closes, or Ctrl+C / q)`,
    );
    let launch;
    try {
      launch = await launchProvider(wrap, prepared.workspacePath, args);
    } catch (err) {
      cleanup();
      error(
        `Failed to launch ${wrap.binary}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      process.exit(1);
    }

    const abortInterrupt = new AbortController();
    const reason = await Promise.race([
      (launch.closed ?? Promise.resolve(0)).then(() => 'closed' as const),
      waitForInterrupt(abortInterrupt.signal).then(() => 'interrupt' as const),
    ]);
    abortInterrupt.abort();

    if (reason === 'interrupt') {
      launch.kill?.();
    }

    cleanup();
    info(reason === 'closed' ? 'Provider window closed — stopped watching.' : 'Stopped watching.');
    process.exit(0);
  }

  // CLI: watchers run in a detached process so this process can spawnSync the
  // TUI without Bun's event-loop stdin reader stealing keystrokes.
  const watchWorker = startDetachedWatchWorker({
    realProjectPath: prepared.realProjectPath,
    workspacePath: prepared.workspacePath,
    providerId: provider.id,
    capabilitiesPath: prepared.capabilitiesPath,
    exclusionProviderIds: prepared.exclusionProviderIds,
  });

  if (!writeWrapSession(prepared.cachePath, {
    pid: process.pid,
    watchPid: watchWorker.pid,
    realProjectPath: prepared.realProjectPath,
    workspacePath: prepared.workspacePath,
  })) {
    console.warn('⚠ Could not write wrap session file; clean/delete may not stop this session.');
  }

  const cleanupCli = () => {
    watchWorker.stop();
    clearWrapSession(prepared.cachePath);
  };

  const onStopSignal = () => {
    cleanupCli();
    process.exit(0);
  };
  process.once('SIGTERM', onStopSignal);
  try {
    process.once('SIGHUP', onStopSignal);
  } catch {
    // Windows
  }

  try {
    const result = await launchProvider(wrap, prepared.workspacePath, args);
    cleanupCli();
    if (result.exitCode != null && result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (err) {
    cleanupCli();
    error(
      `Failed to launch ${wrap.binary}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
}
