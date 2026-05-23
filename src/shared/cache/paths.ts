import { join } from 'path';
import { homedir } from 'os';
import { validateRepoPath } from './validate';

export type CachePlatform = 'github' | 'gitlab';

/** Root cache directory. Override via CAPA_CACHE_DIR for tests. */
export function getCacheDir(): string {
  return process.env.CAPA_CACHE_DIR ?? join(homedir(), '.capa', 'cache');
}

/** Per-repo directory: ~/.capa/cache/git/<platform>/<owner>/<repo>/ */
export function getRepoCacheDir(platform: CachePlatform, repoPath: string): string {
  validateRepoPath(repoPath);
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
