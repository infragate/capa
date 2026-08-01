import type { CapaDatabase } from '../../../db/database';
import type { Hook } from '../../../types/hooks';
import { scopeHookForProvider } from './provider-map';
import { removeManagedHookEntry } from './config-apply';

export interface PruneOrphanHooksResult {
  removed: number;
  warnings: string[];
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
  for (const row of existing) {
    const desired = desiredByProvider.get(row.providerId);
    if (desired && desired.has(row.hookId)) continue;

    try {
      removeManagedHookEntry(projectPath, row);
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
