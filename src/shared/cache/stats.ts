import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { type CachePlatform, getCacheDir } from './paths';

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
