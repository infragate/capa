/**
 * Thin shim — the implementation has moved to `./hooks/` package.
 * This file re-exports the public API so existing imports keep working.
 */
export {
  installHooks,
  pruneOrphanHooks,
  cleanHooks,
  _resolveProviderEventName,
  type InstallHooksOptions,
  type InstallHooksResult,
  type PruneOrphanHooksResult,
  type PruneOrphanHooksOptions,
  type SnapshotResolver,
} from './hooks';
