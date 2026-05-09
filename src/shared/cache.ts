/**
 * Git clone cache for capa.
 *
 * Layout under `~/.capa/cache/`:
 *   git/<platform>/<owner>/<repo>/
 *     mirror/         bare clone, used to cheaply fetch new SHAs
 *     snapshots/<sha>/ checked-out tree at that SHA, .git stripped (cache hit = local copy)
 *
 * The cache is content-addressed by commit SHA. Once a snapshot directory
 * exists for a SHA, subsequent installs are network-free.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import type { AuthenticatedFetch } from './authenticated-fetch';

const execAsync = promisify(exec);

export type CachePlatform = 'github' | 'gitlab';

/** Root cache directory. Override via CAPA_CACHE_DIR for tests. */
export function getCacheDir(): string {
  return process.env.CAPA_CACHE_DIR ?? join(homedir(), '.capa', 'cache');
}

/** Per-repo directory: ~/.capa/cache/git/<platform>/<owner>/<repo>/ */
export function getRepoCacheDir(platform: CachePlatform, repoPath: string): string {
  return join(getCacheDir(), 'git', platform, repoPath);
}

/** Mirror (bare) clone path for a repo. */
export function getRepoMirrorDir(platform: CachePlatform, repoPath: string): string {
  return join(getRepoCacheDir(platform, repoPath), 'mirror');
}

/** Snapshot path for a specific SHA. */
export function getSnapshotDir(
  platform: CachePlatform,
  repoPath: string,
  sha: string
): string {
  return join(getRepoCacheDir(platform, repoPath), 'snapshots', sha);
}

/**
 * Build the authenticated git URL for cloning, embedding an OAuth token when
 * one is available. Mirrors the logic previously inlined in install.ts.
 */
function buildAuthenticatedRepoUrl(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch
): string {
  const baseHost = `${platform}.com`;
  const probeUrl = `https://${baseHost}/${repoPath}`;
  const hasAuth = authFetch.hasAuth(probeUrl);
  if (!hasAuth) {
    return `https://${baseHost}/${repoPath}.git`;
  }
  const token = authFetch.getTokenForUrl(probeUrl);
  return `https://oauth2:${token}@${baseHost}/${repoPath}.git`;
}

/**
 * Ensure a mirror clone exists for the given repo. If it doesn't, perform a
 * bare clone. If it does, leave it as-is — callers can request a fetch via
 * `fetchMirror()` when they need newer refs.
 *
 * Returns the mirror directory path.
 */
export async function ensureMirrorClone(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  repoUrl?: string
): Promise<string> {
  const mirrorDir = getRepoMirrorDir(platform, repoPath);
  if (existsSync(mirrorDir)) {
    return mirrorDir;
  }
  mkdirSync(getRepoCacheDir(platform, repoPath), { recursive: true });
  const url = repoUrl ?? buildAuthenticatedRepoUrl(platform, repoPath, authFetch);
  await execAsync(`git clone --mirror "${url}" "${mirrorDir}"`);
  return mirrorDir;
}

/**
 * Update an existing mirror clone (`git remote update`). Used when a requested
 * version/ref isn't yet present in the mirror.
 */
export async function fetchMirror(mirrorDir: string): Promise<void> {
  await execAsync(`git -C "${mirrorDir}" remote update --prune`);
}

/**
 * Check whether the mirror already contains a given commit/tag/branch ref.
 * Returns the resolved full SHA or null if the ref is unknown.
 */
async function tryResolveRefInMirror(
  mirrorDir: string,
  ref: string
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `git -C "${mirrorDir}" rev-parse --verify "${ref}^{commit}"`
    );
    const sha = stdout.trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Discover the latest semver tag in a mirror clone. Returns null if there
 * are no version-shaped tags.
 */
async function findLatestVersionTag(mirrorDir: string): Promise<string | null> {
  const { stdout } = await execAsync(
    `git -C "${mirrorDir}" tag --list`
  );
  const tags = stdout.trim().split('\n').filter(Boolean);
  const versionTags = tags.filter((t) => /^v?\d+\.\d+\.\d+$/.test(t));
  if (versionTags.length === 0) return null;
  versionTags.sort((a, b) => {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [aMaj, aMin, aPat] = parse(a);
    const [bMaj, bMin, bPat] = parse(b);
    return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
  });
  return versionTags[0];
}

export interface ResolveOptions {
  /** Tag/branch requested in the capabilities file (e.g. "v1.2.3"). */
  version?: string;
  /** Commit SHA explicitly requested in the capabilities file. */
  ref?: string;
  /**
   * Commit SHA already pinned by an existing lockfile entry. When provided we
   * try to use it without hitting the network.
   */
  pinnedSha?: string;
}

export interface ResolveResult {
  /** Full 40-char commit SHA. */
  sha: string;
  /** The tag the SHA corresponds to (auto-discovered for unpinned installs), if any. */
  version: string | null;
}

/**
 * Resolve a (version|ref|pinned|HEAD) request to a concrete commit SHA against
 * a mirror clone. Will fetch the mirror at most once if the ref is unknown.
 */
export async function resolveRef(
  mirrorDir: string,
  opts: ResolveOptions
): Promise<ResolveResult> {
  const { version, ref, pinnedSha } = opts;

  if (pinnedSha) {
    const sha = await tryResolveRefInMirror(mirrorDir, pinnedSha);
    if (sha) return { sha, version: version ?? null };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, pinnedSha);
    if (sha2) return { sha: sha2, version: version ?? null };
    throw new Error(
      `Pinned commit ${pinnedSha} could not be found in repository at ${mirrorDir}`
    );
  }

  if (ref) {
    const sha = await tryResolveRefInMirror(mirrorDir, ref);
    if (sha) return { sha, version: null };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, ref);
    if (sha2) return { sha: sha2, version: null };
    throw new Error(`Commit ${ref} not found in repository at ${mirrorDir}`);
  }

  if (version) {
    const sha = await tryResolveRefInMirror(mirrorDir, version);
    if (sha) return { sha, version };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, version);
    if (sha2) return { sha: sha2, version };
    throw new Error(`Tag/branch "${version}" not found in repository at ${mirrorDir}`);
  }

  // Unpinned: prefer the latest semver tag, fall back to HEAD of default branch.
  const latestTag = await findLatestVersionTag(mirrorDir);
  if (latestTag) {
    const sha = await tryResolveRefInMirror(mirrorDir, latestTag);
    if (sha) return { sha, version: latestTag };
  }
  const headSha = await tryResolveRefInMirror(mirrorDir, 'HEAD');
  if (headSha) return { sha: headSha, version: null };
  throw new Error(`Could not resolve HEAD in repository at ${mirrorDir}`);
}

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
  const snapshotDir = getSnapshotDir(platform, repoPath, sha);
  if (existsSync(snapshotDir)) return snapshotDir;

  mkdirSync(join(getRepoCacheDir(platform, repoPath), 'snapshots'), { recursive: true });

  // Use git worktree to materialize, then drop the .git pointer file. Worktrees
  // are cheap (no full re-clone) and they verify SHA validity for free.
  // We use a temp path then rename so a partial failure doesn't leave a half-
  // populated snapshot dir.
  const tempDir = `${snapshotDir}.partial-${process.pid}-${Date.now()}`;
  try {
    await execAsync(
      `git -C "${mirrorDir}" worktree add --detach --force "${tempDir}" "${sha}"`
    );
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
    await execAsync(`git -C "${mirrorDir}" worktree prune`);
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

/**
 * Recursively compute the byte size of a directory. Returns 0 if the path
 * doesn't exist.
 */
function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          total += dirSize(fullPath);
        } else if (entry.isFile()) {
          total += statSync(fullPath).size;
        }
      } catch {
        // best-effort; ignore unreadable entries
      }
    }
  } catch {
    // best-effort
  }
  return total;
}

export interface CachedRepoInfo {
  platform: CachePlatform;
  repoPath: string;
  mirrorBytes: number;
  snapshotCount: number;
  snapshotBytes: number;
  totalBytes: number;
}

export interface CacheStats {
  cacheDir: string;
  exists: boolean;
  totalBytes: number;
  repos: CachedRepoInfo[];
}

/**
 * Scan the cache directory and return per-repo info plus a total size.
 */
export function getCacheStats(): CacheStats {
  const cacheDir = getCacheDir();
  const gitDir = join(cacheDir, 'git');
  if (!existsSync(gitDir)) {
    return { cacheDir, exists: existsSync(cacheDir), totalBytes: 0, repos: [] };
  }

  const repos: CachedRepoInfo[] = [];
  for (const platformEntry of readdirSync(gitDir, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) continue;
    if (platformEntry.name !== 'github' && platformEntry.name !== 'gitlab') continue;
    const platform = platformEntry.name as CachePlatform;
    const platformDir = join(gitDir, platformEntry.name);

    for (const ownerEntry of readdirSync(platformDir, { withFileTypes: true })) {
      if (!ownerEntry.isDirectory()) continue;
      const ownerDir = join(platformDir, ownerEntry.name);

      for (const repoEntry of readdirSync(ownerDir, { withFileTypes: true })) {
        if (!repoEntry.isDirectory()) continue;
        const repoPath = `${ownerEntry.name}/${repoEntry.name}`;
        const repoDir = join(ownerDir, repoEntry.name);
        const mirrorDir = join(repoDir, 'mirror');
        const snapshotsDir = join(repoDir, 'snapshots');

        const mirrorBytes = dirSize(mirrorDir);
        let snapshotCount = 0;
        let snapshotBytes = 0;
        if (existsSync(snapshotsDir)) {
          for (const snap of readdirSync(snapshotsDir, { withFileTypes: true })) {
            if (!snap.isDirectory()) continue;
            if (snap.name.startsWith('.partial-')) continue;
            snapshotCount++;
            snapshotBytes += dirSize(join(snapshotsDir, snap.name));
          }
        }
        repos.push({
          platform,
          repoPath,
          mirrorBytes,
          snapshotCount,
          snapshotBytes,
          totalBytes: mirrorBytes + snapshotBytes,
        });
      }
    }
  }

  repos.sort((a, b) => b.totalBytes - a.totalBytes);
  const totalBytes = repos.reduce((acc, r) => acc + r.totalBytes, 0);
  return { cacheDir, exists: true, totalBytes, repos };
}

/**
 * Remove the entire cache directory. No-op if it does not exist.
 */
export function cleanCache(): void {
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) return;
  rmSync(cacheDir, { recursive: true, force: true });
}

/**
 * Format a byte size as a human-readable string (KB / MB / GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIdx]}`;
}
