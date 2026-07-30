/**
 * Detached wrap watcher entrypoint.
 *
 * CLI wrap runs the interactive provider via spawnSync (so Bun cannot race it
 * for console input). Live symlink/capabilities sync therefore runs in this
 * separate process: `capa __wrap_watch__ <real> <ws> <providerId> <caps> <exclJson>`
 */
import { startWrapWatchers } from './watch-project';

export async function runWrapWatchWorker(argv: string[]): Promise<void> {
  // argv: [realProjectPath, workspacePath, providerId, capabilitiesPath, exclusionJson]
  const [realProjectPath, workspacePath, providerId, capabilitiesPath, exclusionJson] = argv;
  if (!realProjectPath || !workspacePath || !providerId || !capabilitiesPath) {
    console.error(
      'usage: capa __wrap_watch__ <realPath> <workspacePath> <providerId> <capabilitiesPath> <exclusionJson>',
    );
    process.exit(1);
  }

  let exclusionProviderIds: string[] = [providerId];
  if (exclusionJson) {
    try {
      const parsed = JSON.parse(exclusionJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        exclusionProviderIds = parsed;
      }
    } catch {
      // keep default
    }
  }

  const watchers = startWrapWatchers({
    realProjectPath,
    workspacePath,
    providerId,
    capabilitiesPath,
    exclusionProviderIds,
  });

  const shutdown = () => {
    try {
      watchers.exitSweep();
      watchers.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    process.on('SIGHUP', shutdown);
  } catch {
    // Windows
  }

  // Stay alive until signaled.
  await new Promise<void>(() => {});
}
