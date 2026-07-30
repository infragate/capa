import { watch, type FSWatcher, existsSync, lstatSync, readdirSync } from 'fs';
import { join, resolve, basename } from 'path';
import {
  createWorkspaceSymlink,
  getWrapExclusionSet,
  isLinkedToReal,
  promotePendingEntries,
  promoteToRealProject,
  removeTopLevelEntry,
  syncTopLevelSymlinks,
} from './symlink-workspace';
import { installCommand } from '../../commands/install';
import { parseCapabilitiesFile } from '../../../shared/capabilities';
import { collectWrapExclusionProviderIds } from '../../../shared/providers';
import { isVerbose } from '../../ui';

/** Coalesce burst writes only — keep sync as close to real-time as possible. */
const PROMOTE_COALESCE_MS = 16;
/** Backup poll for platforms where fs.watch drops events (notably Windows). */
const POLL_MS = 200;
/** Wait after the last capabilities edit before re-installing. */
const CAPABILITIES_DEBOUNCE_MS = 2000;

export interface WrapWatchers {
  stop: () => void;
  /** Promote any pending workspace-only top-level entries (call on exit). */
  exitSweep: () => void;
}

interface WatchOpts {
  realProjectPath: string;
  workspacePath: string;
  providerId: string;
  capabilitiesPath: string;
  /** Wrap target + capabilities.providers — drives symlink exclusions. */
  exclusionProviderIds: string[];
}

function entryExists(root: string, name: string): boolean {
  try {
    lstatSync(join(root, name));
    return true;
  } catch {
    return false;
  }
}

/** Single in-place status line for capabilities re-apply (avoids log spam). */
function writeReapplyStatus(message: string | null): void {
  if (!process.stderr.isTTY) {
    if (message) process.stderr.write(`[wrap] ${message}\n`);
    return;
  }
  if (message == null) {
    process.stderr.write('\r\x1b[K');
    return;
  }
  process.stderr.write(`\r\x1b[K[wrap] ${message}`);
}

/**
 * Start bidirectional top-level watchers + capabilities live re-apply.
 * Handles creates, updates, and deletions in both directions.
 */
export function startWrapWatchers(opts: WatchOpts): WrapWatchers {
  const realRoot = resolve(opts.realProjectPath);
  const wsRoot = resolve(opts.workspacePath);
  let providerIds = [...opts.exclusionProviderIds];
  let excluded = getWrapExclusionSet(providerIds);
  const ignoreReal = new Set<string>();
  const ignoreWs = new Set<string>();
  const promoteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Names we keep in sync both ways — do not resurrect after a delete. */
  const synced = new Set<string>();

  let capsTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reapplyRunning = false;
  let reapplyQueued = false;
  let stopped = false;

  const watchers: FSWatcher[] = [];

  function brieflyIgnore(name: string): void {
    ignoreReal.add(name);
    ignoreWs.add(name);
    setTimeout(() => {
      ignoreReal.delete(name);
      ignoreWs.delete(name);
    }, 50);
  }

  function flushPromote(name: string): void {
    if (excluded.has(name) || stopped) return;
    if (!entryExists(wsRoot, name)) return;
    if (isLinkedToReal(realRoot, wsRoot, name)) {
      synced.add(name);
      return;
    }

    brieflyIgnore(name);
    try {
      promoteToRealProject(realRoot, wsRoot, name, providerIds);
      if (entryExists(realRoot, name)) synced.add(name);
    } catch {
      // quiet
    }
  }

  function schedulePromote(name: string): void {
    if (excluded.has(name) || stopped || ignoreWs.has(name)) return;
    if (isLinkedToReal(realRoot, wsRoot, name)) {
      synced.add(name);
      return;
    }

    const existing = promoteTimers.get(name);
    if (existing) clearTimeout(existing);

    promoteTimers.set(
      name,
      setTimeout(() => {
        promoteTimers.delete(name);
        flushPromote(name);
      }, PROMOTE_COALESCE_MS),
    );
  }

  /** Real deleted → drop workspace copy (do not let poll resurrect it). */
  function syncDeleteFromReal(name: string): void {
    if (excluded.has(name) || stopped || ignoreReal.has(name)) return;
    brieflyIgnore(name);
    removeTopLevelEntry(wsRoot, name);
    synced.delete(name);
  }

  /** Workspace deleted → drop real copy. */
  function syncDeleteFromWorkspace(name: string): void {
    if (excluded.has(name) || stopped || ignoreWs.has(name)) return;
    brieflyIgnore(name);
    removeTopLevelEntry(realRoot, name);
    synced.delete(name);
  }

  function reconcile(): void {
    if (stopped) return;

    let realNames: string[] = [];
    let wsNames: string[] = [];
    try {
      realNames = readdirSync(realRoot).filter((n) => !excluded.has(n));
    } catch {
      return;
    }
    try {
      wsNames = readdirSync(wsRoot).filter((n) => !excluded.has(n));
    } catch {
      return;
    }

    const realSet = new Set(realNames);
    const wsSet = new Set(wsNames);

    // Synced name missing on real → remove from workspace (deletion sync).
    for (const name of [...synced]) {
      if (excluded.has(name)) {
        synced.delete(name);
        continue;
      }
      const onReal = realSet.has(name);
      const onWs = wsSet.has(name);
      if (!onReal && onWs) {
        syncDeleteFromReal(name);
      } else if (onReal && !onWs) {
        syncDeleteFromWorkspace(name);
      } else if (!onReal && !onWs) {
        synced.delete(name);
      }
    }

    // Real has it, workspace missing → link into workspace.
    for (const name of realNames) {
      if (ignoreReal.has(name)) continue;
      if (!wsSet.has(name)) {
        brieflyIgnore(name);
        try {
          createWorkspaceSymlink(join(realRoot, name), join(wsRoot, name));
          synced.add(name);
        } catch {
          // quiet
        }
      } else if (isLinkedToReal(realRoot, wsRoot, name) || entryExists(wsRoot, name)) {
        synced.add(name);
      }
    }

    // Workspace-only: new agent file → promote. Broken symlink / leftover after
    // real delete that's still in synced was handled above.
    for (const name of wsNames) {
      if (ignoreWs.has(name) || realSet.has(name)) continue;
      if (synced.has(name)) {
        // Real gone but still marked synced — remove workspace copy.
        syncDeleteFromReal(name);
        continue;
      }
      try {
        const st = lstatSync(join(wsRoot, name));
        if (st.isSymbolicLink()) {
          // Dangling link to deleted real path.
          syncDeleteFromReal(name);
          continue;
        }
      } catch {
        continue;
      }
      flushPromote(name);
    }
  }

  async function refreshExclusionProviders(): Promise<void> {
    try {
      const capsPath = resolve(opts.capabilitiesPath);
      const format = capsPath.endsWith('.json') ? 'json' : 'yaml';
      const capabilities = await parseCapabilitiesFile(capsPath, format);
      providerIds = collectWrapExclusionProviderIds(opts.providerId, capabilities.providers);
      excluded = getWrapExclusionSet(providerIds);
    } catch {
      // Keep last good exclusion set.
    }
  }

  async function reapplyCapabilities(): Promise<void> {
    if (stopped) return;
    if (reapplyRunning) {
      reapplyQueued = true;
      return;
    }
    reapplyRunning = true;
    writeReapplyStatus('Re-applying capabilities…');
    try {
      await refreshExclusionProviders();
      await installCommand({
        projectPath: wsRoot,
        identityPath: realRoot,
        provider: opts.providerId,
        exitProcess: false,
        quiet: true,
      });
      try {
        const linked = syncTopLevelSymlinks(realRoot, wsRoot, providerIds);
        for (const name of linked) synced.add(name);
      } catch {
        // ignore
      }
      writeReapplyStatus('Capabilities re-applied');
    } catch (err) {
      writeReapplyStatus(
        `Capabilities re-apply failed (keeping last good)${
          isVerbose()
            ? `: ${err instanceof Error ? err.message : String(err)}`
            : ''
        }`,
      );
    } finally {
      reapplyRunning = false;
      if (reapplyQueued) {
        reapplyQueued = false;
        void reapplyCapabilities();
      } else {
        // Clear the status line after a short beat so it doesn't linger forever.
        setTimeout(() => {
          if (!reapplyRunning) writeReapplyStatus(null);
        }, 1500);
      }
    }
  }

  function onRealChange(filename: string | null): void {
    if (!filename || stopped) return;
    const name = filename.split(/[/\\]/)[0];
    if (!name || excluded.has(name) || ignoreReal.has(name)) return;

    if (!entryExists(realRoot, name)) {
      syncDeleteFromReal(name);
      return;
    }

    const link = join(wsRoot, name);
    if (entryExists(wsRoot, name)) {
      synced.add(name);
      return;
    }
    try {
      brieflyIgnore(name);
      createWorkspaceSymlink(join(realRoot, name), link);
      synced.add(name);
    } catch {
      // quiet
    }
  }

  function onWsChange(filename: string | null): void {
    if (!filename || stopped) return;
    const name = filename.split(/[/\\]/)[0];
    if (!name || excluded.has(name) || ignoreWs.has(name)) return;

    if (!entryExists(wsRoot, name)) {
      syncDeleteFromWorkspace(name);
      return;
    }

    schedulePromote(name);
  }

  function onCapsChange(): void {
    if (stopped) return;
    if (capsTimer) clearTimeout(capsTimer);
    capsTimer = setTimeout(() => {
      capsTimer = null;
      void reapplyCapabilities();
    }, CAPABILITIES_DEBOUNCE_MS);
  }

  try {
    watchers.push(
      watch(realRoot, { persistent: true }, (_event, filename) => {
        onRealChange(filename != null ? String(filename) : null);
      }),
    );
  } catch {
    // fs.watch may fail on some platforms
  }

  try {
    watchers.push(
      watch(wsRoot, { persistent: true }, (_event, filename) => {
        onWsChange(filename != null ? String(filename) : null);
      }),
    );
  } catch {
    // ignore
  }

  const capsFile = resolve(opts.capabilitiesPath);
  const capsDir = resolve(capsFile, '..');
  const capsBase = basename(capsFile);
  try {
    watchers.push(
      watch(capsDir, { persistent: true }, (_event, filename) => {
        if (filename != null && String(filename) === capsBase) onCapsChange();
      }),
    );
  } catch {
    // ignore
  }

  try {
    const linked = syncTopLevelSymlinks(realRoot, wsRoot, providerIds);
    for (const name of linked) synced.add(name);
  } catch {
    // ignore
  }

  pollTimer = setInterval(reconcile, POLL_MS);
  if (typeof pollTimer === 'object' && pollTimer && 'unref' in pollTimer) {
    (pollTimer as NodeJS.Timeout).unref?.();
  }

  return {
    stop() {
      stopped = true;
      writeReapplyStatus(null);
      if (capsTimer) clearTimeout(capsTimer);
      if (pollTimer) clearInterval(pollTimer);
      for (const t of promoteTimers.values()) clearTimeout(t);
      promoteTimers.clear();
      for (const w of watchers) {
        try {
          w.close();
        } catch {}
      }
    },
    exitSweep() {
      for (const name of [...promoteTimers.keys()]) {
        const t = promoteTimers.get(name);
        if (t) clearTimeout(t);
        promoteTimers.delete(name);
        flushPromote(name);
      }
      try {
        // Only promote genuinely new workspace-only files (not resurrected deletes).
        const realSet = new Set(readdirSync(realRoot));
        for (const name of readdirSync(wsRoot)) {
          if (excluded.has(name) || realSet.has(name) || synced.has(name)) continue;
          try {
            if (lstatSync(join(wsRoot, name)).isSymbolicLink()) {
              removeTopLevelEntry(wsRoot, name);
              continue;
            }
          } catch {
            continue;
          }
          promoteToRealProject(realRoot, wsRoot, name, providerIds);
        }
      } catch {
        try {
          promotePendingEntries(realRoot, wsRoot, providerIds);
        } catch {}
      }
    },
  };
}
