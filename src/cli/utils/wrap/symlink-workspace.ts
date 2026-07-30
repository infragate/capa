import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  linkSync,
  copyFileSync,
  cpSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { getProviderOwnedTopLevelNames } from '../../../shared/providers';
import { LOCKFILE_NAME } from '../../../shared/lockfile';
import { WORKSPACE_MARKER } from '../../../shared/workspaces/paths';

const isWin = platform() === 'win32';

/** Always excluded from the symlink tree (in addition to provider-owned names). */
export const ALWAYS_EXCLUDE = new Set([
  LOCKFILE_NAME,
  '.capa',
  WORKSPACE_MARKER,
]);

/**
 * Exclusion set for wrap symlink/sync: always-exclude names plus owned paths of
 * the wrap provider and any providers listed in capabilities.yaml.
 */
export function getWrapExclusionSet(providerIds: Iterable<string>): Set<string> {
  const names = getProviderOwnedTopLevelNames(providerIds);
  for (const n of ALWAYS_EXCLUDE) names.add(n);
  return names;
}

function symlinkErrorMessage(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code === 'EPERM' || code === 'EACCES') {
    return (
      'Failed to create symlink (permission denied). ' +
      (isWin
        ? 'Enable Windows Developer Mode or run with elevated privileges for symlink creation.'
        : 'Check filesystem permissions.')
    );
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create a symlink (Windows: directory junction; file symlink with hard-link fallback)
 * from `linkPath` to `targetPath`.
 */
export function createWorkspaceSymlink(targetPath: string, linkPath: string): void {
  const targetIsDir = existsSync(targetPath) && statSync(targetPath).isDirectory();
  try {
    if (isWin) {
      if (targetIsDir) {
        symlinkSync(targetPath, linkPath, 'junction');
      } else {
        try {
          symlinkSync(targetPath, linkPath, 'file');
        } catch {
          // File symlinks need Developer Mode; hard links work on the same volume.
          linkSync(targetPath, linkPath);
        }
      }
    } else {
      symlinkSync(targetPath, linkPath);
    }
  } catch (err) {
    throw new Error(symlinkErrorMessage(err));
  }
}

/**
 * Build (or refresh) top-level symlinks from real project → workspace.
 * Skips excluded names and entries that already exist in the workspace.
 */
export function syncTopLevelSymlinks(
  realProjectPath: string,
  workspacePath: string,
  providerIds: Iterable<string>,
): string[] {
  const excluded = getWrapExclusionSet(providerIds);
  const realRoot = resolve(realProjectPath);
  const wsRoot = resolve(workspacePath);
  mkdirSync(wsRoot, { recursive: true });

  const linked: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(realRoot);
  } catch (err) {
    throw new Error(
      `Cannot read project directory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const name of entries) {
    if (excluded.has(name)) continue;
    const target = join(realRoot, name);
    const link = join(wsRoot, name);
    try {
      lstatSync(link);
      // Already present — still count as synced if it links to real (or is our mirror).
      linked.push(name);
      continue;
    } catch {
      // does not exist
    }
    createWorkspaceSymlink(target, link);
    linked.push(name);
  }
  return linked;
}

/**
 * Remove a top-level entry from a root (file, dir, symlink, or junction).
 */
export function removeTopLevelEntry(root: string, name: string): void {
  const target = join(resolve(root), name);
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Full cold build: ensure workspace dir, sync all top-level symlinks.
 */
export function buildSymlinkWorkspace(
  realProjectPath: string,
  workspacePath: string,
  providerIds: Iterable<string>,
): void {
  mkdirSync(workspacePath, { recursive: true });
  syncTopLevelSymlinks(realProjectPath, workspacePath, providerIds);
}

function isAlreadyLinked(wsEntry: string, realEntry: string): boolean {
  try {
    if (lstatSync(wsEntry).isSymbolicLink()) return true;
  } catch {
    return false;
  }
  try {
    if (!existsSync(realEntry)) return false;
    const a = statSync(wsEntry);
    const b = statSync(realEntry);
    return a.ino === b.ino && a.dev === b.dev;
  } catch {
    return false;
  }
}

/** True when the workspace entry already shares storage with the real path. */
export function isLinkedToReal(
  realProjectPath: string,
  workspacePath: string,
  name: string,
): boolean {
  const wsEntry = join(resolve(workspacePath), name);
  const realEntry = join(resolve(realProjectPath), name);
  return isAlreadyLinked(wsEntry, realEntry);
}

/**
 * Try to replace a workspace path with a symlink/junction/hardlink to `realEntry`.
 * Returns true on success. On failure the workspace entry is left as-is (caller may mirror).
 */
function tryRelink(realEntry: string, wsEntry: string): boolean {
  try {
    if (existsSync(wsEntry)) {
      // Only remove if not already the link we want
      if (isAlreadyLinked(wsEntry, realEntry)) return true;
      rmSync(wsEntry, { recursive: true, force: true });
    }
    createWorkspaceSymlink(realEntry, wsEntry);
    return true;
  } catch {
    return false;
  }
}

/**
 * Push a workspace top-level entry into the real project immediately, then prefer
 * replacing the workspace copy with a link so further edits are shared in place.
 *
 * If linking fails (e.g. cross-volume hardlink on Windows), content is still
 * copied to the real project so the original stays up to date; the next change
 * will mirror again.
 */
export function promoteToRealProject(
  realProjectPath: string,
  workspacePath: string,
  name: string,
  providerIds: Iterable<string>,
): void {
  const excluded = getWrapExclusionSet(providerIds);
  if (excluded.has(name)) return;

  const wsEntry = join(resolve(workspacePath), name);
  const realEntry = join(resolve(realProjectPath), name);

  let st;
  try {
    st = lstatSync(wsEntry);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (isAlreadyLinked(wsEntry, realEntry)) return;

  if (st.isDirectory()) {
    if (!existsSync(realEntry)) {
      try {
        renameSync(wsEntry, realEntry);
      } catch {
        cpSync(wsEntry, realEntry, { recursive: true });
        rmSync(wsEntry, { recursive: true, force: true });
      }
      tryRelink(realEntry, wsEntry);
      return;
    }
    // Both dirs exist separately — prefer linking workspace to real (real wins structure).
    // Do not delete workspace content without linking; try junction/symlink only.
    tryRelink(realEntry, wsEntry);
    return;
  }

  // File: always push workspace bytes to real first (agent edits win).
  try {
    if (!existsSync(realEntry)) {
      try {
        renameSync(wsEntry, realEntry);
      } catch {
        copyFileSync(wsEntry, realEntry);
        rmSync(wsEntry, { force: true });
      }
      if (!tryRelink(realEntry, wsEntry)) {
        // Cross-device / no symlink privilege: put a regular copy back in workspace
        // and keep mirroring on subsequent events.
        if (!existsSync(wsEntry)) {
          copyFileSync(realEntry, wsEntry);
        }
      }
      return;
    }

    // Real exists as a separate file — overwrite with workspace content, then link.
    copyFileSync(wsEntry, realEntry);
    if (!tryRelink(realEntry, wsEntry)) {
      // Keep workspace file; content already mirrored to real.
    }
  } catch {
    // best-effort
  }
}

/**
 * Mirror every unlinked top-level workspace entry into the real project.
 * Safe to call frequently (poll / watch / exit).
 */
export function promotePendingEntries(
  realProjectPath: string,
  workspacePath: string,
  providerIds: Iterable<string>,
): void {
  const excluded = getWrapExclusionSet(providerIds);
  const wsRoot = resolve(workspacePath);
  let entries: string[];
  try {
    entries = readdirSync(wsRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    if (excluded.has(name)) continue;
    try {
      const st = lstatSync(join(wsRoot, name));
      if (st.isSymbolicLink()) continue;
      if (isLinkedToReal(realProjectPath, workspacePath, name)) continue;
    } catch {
      continue;
    }
    try {
      promoteToRealProject(realProjectPath, workspacePath, name, providerIds);
    } catch {
      // best-effort
    }
  }
}
