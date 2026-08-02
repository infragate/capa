import type { CapaDatabase } from '../../../db/database';
import type { Hook } from '../../../types/hooks';
import { isPathInside } from '../../../shared/paths';
import { scopeHookForProvider } from './provider-map';
import { removeManagedHookEntry } from './config-apply';

export interface PruneOrphanHooksResult {
  removed: number;
  warnings: string[];
}

export interface PruneOrphanHooksOptions {
  /**
   * When true, only prune within `desiredProviders`. Managed hooks for other
   * providers are left alone (DB + on-disk).
   *
   * Used by `capa wrap` shadow installs: they share the real project's
   * `projectId` / `managed_hooks` rows but install for a single provider into
   * a shadow workspace. Without this, cursor hooks would be treated as orphans
   * and removed via their stored absolute `configPath` in the real project.
   */
  onlyDesiredProviders?: boolean;
  /**
   * When set, never mutate (or drop DB rows for) managed hooks whose
   * `configPath` lies outside this directory.
   *
   * Wrap installs pass the shadow workspace path so capa wrap cannot touch
   * the real project's hook configs — even for the same provider id.
   */
  mutateRoot?: string;
}

/**
 * Bring `db.managed_hooks` in sync with the current capabilities file by
 * removing entries that are no longer requested (per provider).
 */
export function pruneOrphanHooks(
  projectPath: string,
  projectId: string,
  desiredHooks: Hook[],
  desiredProviders: string[],
  db: CapaDatabase,
  options: PruneOrphanHooksOptions = {},
): PruneOrphanHooksResult {
  const warnings: string[] = [];
  let removed = 0;

  const desiredByProvider = new Map<string, Set<string>>();
  for (const providerId of desiredProviders) {
    const ids = new Set<string>();
    for (const h of desiredHooks) {
      const targets = scopeHookForProvider(h, providerId);
      if (targets) ids.add(h.id);
    }
    desiredByProvider.set(providerId, ids);
  }

  const existing = db.getManagedHooks(projectId);
  const toRemove: typeof existing = [];
  const toKeep: typeof existing = [];
  for (const row of existing) {
    const desired = desiredByProvider.get(row.providerId);
    if (desired && desired.has(row.hookId)) {
      toKeep.push(row);
      continue;
    }
    // Wrap / scoped installs: other providers' rows are still desired on the
    // identity project — do not treat them as orphans.
    if (options.onlyDesiredProviders && !desiredByProvider.has(row.providerId)) {
      toKeep.push(row);
      continue;
    }
    // Hard invariant for wrap: never write outside the shadow workspace.
    if (options.mutateRoot && !isPathInside(row.configPath, options.mutateRoot)) {
      toKeep.push(row);
      continue;
    }
    toRemove.push(row);
  }

  // Materialized scripts live at ~/.capa/hooks/<projectId>/<hookId> and are
  // shared across providers for the same hookId. Only unlink when no kept row
  // still references that path.
  const retainedScripts = new Set(
    toKeep.map((r) => r.scriptPath).filter((p): p is string => !!p),
  );

  for (const row of toRemove) {
    try {
      const preserveScript = !!(row.scriptPath && retainedScripts.has(row.scriptPath));
      removeManagedHookEntry(projectPath, row, { preserveScript });
      removed++;
      db.removeManagedHook(row.projectId, row.providerId, row.hookId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${row.hookId}" on "${row.providerId}": prune failed — ${msg}`);
    }
  }
  return { removed, warnings };
}

/**
 * Remove every capa-managed hook entry for `projectId`. Used by `capa clean`.
 */
export function cleanHooks(projectPath: string, projectId: string, db: CapaDatabase): { removed: number; warnings: string[] } {
  const warnings: string[] = [];
  let removed = 0;
  const rows = db.getManagedHooks(projectId);
  for (const row of rows) {
    try {
      removeManagedHookEntry(projectPath, row);
      removed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${row.hookId}" on "${row.providerId}": clean failed — ${msg}`);
    }
  }
  db.clearManagedHooks(projectId);
  return { removed, warnings };
}
