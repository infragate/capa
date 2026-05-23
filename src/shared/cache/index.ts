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

export type { CachePlatform } from './paths';
export {
  getCacheDir,
  getRepoCacheDir,
  getRepoMirrorDir,
  getSnapshotDir,
} from './paths';

export {
  ensureMirrorClone,
  fetchMirror,
  resolveRef,
  type ResolveOptions,
  type ResolveResult,
} from './mirror';

export {
  materializeSnapshot,
  getOrCreateSnapshot,
  type GetSnapshotOptions,
  type GetSnapshotResult,
} from './snapshot';

export {
  getCacheStats,
  cleanCache,
  formatBytes,
  type CachedRepoInfo,
  type CacheStats,
} from './stats';
