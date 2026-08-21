import { existsSync, lstatSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { collectProviderInstallRelativePaths } from '../../../shared/install-path-guard';
import { getProvider, resolveProviderId } from '../../../shared/providers';
import {
  ALWAYS_EXCLUDE,
  getWrapExclusionSet,
  isLinkedToReal,
  removeTopLevelEntry,
  syncTopLevelSymlinks,
} from './symlink-workspace';

export interface ShadowWorkspaceRepairResult {
  /** Human-readable paths that were removed or repaired. */
  repaired: string[];
  /** When true, provider materialization should be re-run (capa install). */
  needsReinstall: boolean;
}

/**
 * Validate and repair a wrap shadow workspace before each session.
 *
 * - Top-level provider dirs (`.cursor`, `.claude`, …) must be real directories
 *   owned by the shadow workspace — never symlinks/junctions into the real project.
 * - Nested provider install paths (e.g. `.cursor/skills`) must not be symlinks
 *   that collapse writes into the real tree.
 * - Missing top-level project entries are symlinked from the real project.
 */
function getRequiredMaterializedTopLevelNames(
  providerIds: Iterable<string>,
): Set<string> {
  const names = new Set<string>();
  for (const raw of providerIds) {
    const id = resolveProviderId(raw) ?? raw.trim().toLowerCase();
    const p = getProvider(id);
    if (!p) continue;
    if (p.skillsDir) {
      const top = p.skillsDir.replace(/\\/g, '/').replace(/^\.\//, '').split('/')[0];
      if (top) names.add(top);
    }
    if (p.instructions?.filename && !p.instructions.filename.includes('/')) {
      names.add(p.instructions.filename);
    }
  }
  return names;
}

export function validateAndRepairShadowWorkspace(
  realProjectPath: string,
  workspacePath: string,
  providerIds: Iterable<string>,
): ShadowWorkspaceRepairResult {
  const excluded = getWrapExclusionSet(providerIds);
  const required = getRequiredMaterializedTopLevelNames(providerIds);
  const wsRoot = resolve(workspacePath);
  const realRoot = resolve(realProjectPath);
  const repaired: string[] = [];
  let needsReinstall = false;

  for (const name of excluded) {
    if (ALWAYS_EXCLUDE.has(name)) continue;
    const wsEntry = join(wsRoot, name);
    try {
      if (!existsSync(wsEntry)) {
        if (required.has(name)) needsReinstall = true;
        continue;
      }
      const st = lstatSync(wsEntry);
      if (st.isSymbolicLink() || isLinkedToReal(realRoot, wsRoot, name)) {
        removeTopLevelEntry(wsRoot, name);
        repaired.push(name);
        needsReinstall = true;
      }
    } catch {
      needsReinstall = true;
    }
  }

  for (const rel of collectProviderInstallRelativePaths(providerIds)) {
    const wsPath = join(wsRoot, rel);
    if (!existsSync(wsPath)) continue;
    try {
      const st = lstatSync(wsPath);
      if (!st.isSymbolicLink()) continue;
      rmSync(wsPath, { recursive: true, force: true });
      repaired.push(rel);
      needsReinstall = true;
    } catch {
      // best-effort
    }
  }

  syncTopLevelSymlinks(realProjectPath, workspacePath, providerIds);

  return { repaired, needsReinstall };
}
