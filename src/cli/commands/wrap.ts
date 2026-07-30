import { resolve } from 'path';
import {
  getWrappableProvider,
  getWrappableProviders,
} from '../../shared/providers';
import { prepareWorkspace, pruneWorkspaces } from '../utils/wrap/workspace';
import { startWrapWatchers } from '../utils/wrap/watch-project';
import { launchProvider } from '../utils/wrap/launch';
import { waitForInterrupt } from '../utils/wrap/wait-for-interrupt';
import { info, error } from '../ui';

export interface WrapOptions {
  project?: string;
  printDir?: boolean;
  prune?: boolean;
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

  if (!providerArg) {
    const available = getWrappableProviders()
      .map((p) => p.id)
      .sort()
      .join(', ');
    error(`Missing provider. Wrappable providers: ${available || '(none)'}`);
    process.exit(1);
  }

  const provider = getWrappableProvider(providerArg);
  if (!provider || !provider.wrap) {
    const available = getWrappableProviders()
      .map((p) => `${p.id}${p.pluginProviderId ? ` (alias: ${p.pluginProviderId})` : ''}`)
      .sort()
      .join(', ');
    error(
      `Unknown or non-wrappable provider "${providerArg}".\n` +
        `  Available: ${available || '(none)'}`,
    );
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
      : `Reusing wrap workspace for ${provider.displayName}`,
  );
  info(prepared.workspacePath);

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

  if (provider.wrap.kind === 'gui') {
    info(
      `Launching ${provider.wrap.binary} (wrap stops when the window closes, or Ctrl+C / q)`,
    );
    let launch;
    try {
      launch = await launchProvider(provider, prepared.workspacePath, args);
    } catch (err) {
      cleanup();
      error(
        `Failed to launch ${provider.wrap.binary}: ${
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

  // CLI: blocking
  try {
    const result = await launchProvider(provider, prepared.workspacePath, args);
    cleanup();
    if (result.exitCode != null && result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (err) {
    cleanup();
    error(
      `Failed to launch ${provider.wrap.binary}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
}
