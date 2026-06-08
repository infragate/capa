import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { AuthenticatedFetch } from '../authenticated-fetch';
import { validateRepoPath } from './validate';
import {
  type CachePlatform,
  getRepoCacheDir,
  getSnapshotDir,
} from './paths';
import {
  ensureMirrorClone,
  resolveRef,
  type ResolveOptions,
} from './mirror';
import { git } from './git-cli';

/**
 * Materialize a snapshot directory at the given SHA from a mirror clone. If
 * the snapshot already exists, this is a no-op. The resulting directory has
 * `.git` stripped so it can be safely copied as plain files.
 */
export async function materializeSnapshot(
  mirrorDir: string,
  platform: CachePlatform,
  repoPath: string,
  sha: string
): Promise<string> {
  validateRepoPath(repoPath);
  const snapshotDir = getSnapshotDir(platform, repoPath, sha);
  if (existsSync(snapshotDir)) return snapshotDir;

  mkdirSync(join(getRepoCacheDir(platform, repoPath), 'snapshots'), { recursive: true });

  // Use git worktree to materialize, then drop the .git pointer file. Worktrees
  // are cheap (no full re-clone) and they verify SHA validity for free.
  // We use a temp path then rename so a partial failure doesn't leave a half-
  // populated snapshot dir.
  const tempDir = `${snapshotDir}.partial-${process.pid}-${Date.now()}`;
  try {
    await git([
      '-C',
      mirrorDir,
      'worktree',
      'add',
      '--detach',
      '--force',
      tempDir,
      sha,
    ]);
  } catch (err: any) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw err;
  }

  // Drop the .git pointer file (worktree-managed) so this is a plain dir.
  try {
    rmSync(join(tempDir, '.git'), { recursive: true, force: true });
  } catch {}
  // Detach the worktree from the mirror's bookkeeping.
  try {
    await git(['-C', mirrorDir, 'worktree', 'prune']);
  } catch {}

  // Atomic-ish rename into place.
  try {
    if (existsSync(snapshotDir)) {
      // Race with a concurrent install. Drop our temp copy.
      rmSync(tempDir, { recursive: true, force: true });
    } else {
      // fs.renameSync isn't reliably atomic across all filesystems but is the
      // best we have without a lockfile.
      const { renameSync } = await import('fs');
      renameSync(tempDir, snapshotDir);
    }
  } catch (err: any) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw err;
  }

  return snapshotDir;
}

export interface GetSnapshotOptions extends ResolveOptions {
  platform: CachePlatform;
  repoPath: string;
  authFetch: AuthenticatedFetch;
  /** When true, ignore any existing snapshot/mirror state and re-resolve from network. */
  noCache?: boolean;
  /** Override the clone URL instead of deriving it from platform/repoPath (useful for tests). */
  repoUrl?: string;
}

export interface GetSnapshotResult {
  snapshotDir: string;
  resolvedSha: string;
  resolvedVersion: string | null;
}

/**
 * Top-level entry point used by the install pipeline. Combines mirror, ref
 * resolution, and snapshot materialization. Network calls are skipped when
 * a pinned SHA already has a snapshot on disk.
 */
export async function getOrCreateSnapshot(
  opts: GetSnapshotOptions
): Promise<GetSnapshotResult> {
  const { platform, repoPath, authFetch, noCache } = opts;
  validateRepoPath(repoPath);

  if (noCache) {
    // Wipe any existing per-repo cache so we re-clone fresh.
    const repoDir = getRepoCacheDir(platform, repoPath);
    if (existsSync(repoDir)) {
      try { rmSync(repoDir, { recursive: true, force: true }); } catch {}
    }
  }

  // Fast path: pinned SHA with an existing snapshot — fully offline.
  if (opts.pinnedSha && !noCache) {
    const fullSha = opts.pinnedSha.length === 40
      ? opts.pinnedSha
      : null;
    if (fullSha) {
      const snapshotDir = getSnapshotDir(platform, repoPath, fullSha);
      if (existsSync(snapshotDir)) {
        return {
          snapshotDir,
          resolvedSha: fullSha,
          resolvedVersion: opts.version ?? null,
        };
      }
    }
  }

  const mirrorDir = await ensureMirrorClone(platform, repoPath, authFetch, opts.repoUrl);
  const { sha, version } = await resolveRef(mirrorDir, {
    version: opts.version,
    ref: opts.ref,
    pinnedSha: opts.pinnedSha,
  });
  const snapshotDir = await materializeSnapshot(mirrorDir, platform, repoPath, sha);
  return { snapshotDir, resolvedSha: sha, resolvedVersion: version };
}
