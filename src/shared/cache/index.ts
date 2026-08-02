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

export {
	ensureMirrorClone,
	fetchMirror,
	type ResolveOptions,
	type ResolveResult,
	resolveRef,
} from "./mirror";
export type { CachePlatform } from "./paths";
export {
	getCacheDir,
	getRepoCacheDir,
	getRepoMirrorDir,
	getSnapshotDir,
} from "./paths";

export {
	type GetSnapshotOptions,
	type GetSnapshotResult,
	getOrCreateSnapshot,
	materializeSnapshot,
} from "./snapshot";

export {
	type CachedRepoInfo,
	type CacheStats,
	cleanCache,
	formatBytes,
	getCacheStats,
} from "./stats";
