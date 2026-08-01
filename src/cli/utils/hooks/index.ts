/**
 * Install / prune lifecycle hooks across providers.
 *
 * `installHooks`:
 *   1. Resolve each hook's body (inline / remote / github / gitlab / local)
 *      and materialise `command`-type bodies under
 *      `~/.capa/hooks/<projectId>/<hookId>` (chmod +x by default).
 *   2. For every `(provider, hook)` pair where the provider supports the
 *      requested event, build the shape-specific entry, upsert it into the
 *      provider's config file, and record the entry in `db.managed_hooks`.
 *   3. Surface warnings (rather than throwing) for unsupported providers,
 *      missing event mappings, write failures, etc.
 *
 * `pruneOrphanHooks`:
 *   • Walks `db.managed_hooks` and removes every entry whose provider /
 *     hook combination is no longer requested by the current capabilities
 *     file. Stale config entries are removed surgically using the stored
 *     locator; the row is dropped from the DB.
 *
 * `cleanHooks`:
 *   • Used by `capa clean` to remove every capa-installed hook entry for
 *     a project regardless of the current capabilities file.
 */

export {
  installHooks,
  type InstallHooksOptions,
  type InstallHooksResult,
  type SnapshotResolver,
} from './install';

export {
  pruneOrphanHooks,
  cleanHooks,
  type PruneOrphanHooksResult,
} from './prune';

export { resolveProviderEventName as _resolveProviderEventName } from './provider-map';
