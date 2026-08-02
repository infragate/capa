import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { getLockfilePath } from '../../shared/lockfile';
import { resolveProvidersForClean } from '../../shared/providers/resolve';
import { getAllProviders } from '../../shared/providers';
import type { CapaDatabase } from '../../db/database';
import type { Capabilities } from '../../types/capabilities';
import { unregisterMCPServer, unregisterSubAgentMCPServer } from '../utils/mcp-client-manager';
import { cleanAgentsFile, removeSubAgentInstructions } from '../utils/agents-file';
import { cleanRules } from '../utils/rules-installer';
import { cleanHooks } from '../utils/hooks-installer';
import { stopWrapSessionsForProject } from '../utils/wrap/sessions';
import { pruneWorkspacesForProject } from '../utils/wrap/workspace';

export interface CleanProjectOptions {
  projectPath: string;
  projectId: string;
  db: CapaDatabase;
  /** When omitted, capabilities are loaded from the project path if present. */
  capabilities?: Capabilities;
}

export interface CleanProjectResult {
  warnings: string[];
  wrapSessionsStopped: number;
  workspacesPruned: number;
  managedFilesRemoved: number;
}

/**
 * When capabilities.yaml omits `providers:` and the DB row is already gone,
 * still sweep every provider that owns on-disk agent/rule artifacts so clean
 * can remove leftover files from a previous install.
 */
function providersForOnDiskCleanup(resolved: string[]): string[] {
  if (resolved.length > 0) return resolved;
  return getAllProviders()
    .filter((p) => p.subagents || p.rules || p.instructions || p.mcp)
    .map((p) => p.id);
}

/**
 * Tear down capa-managed state for a project: stop wrap sessions, remove
 * managed artifacts / MCP wiring, prune wrap workspaces, delete DB rows.
 * Does not delete capabilities.yaml / capabilities.json.
 */
export async function cleanProject(opts: CleanProjectOptions): Promise<CleanProjectResult> {
  const projectPath = resolve(opts.projectPath);
  const { projectId, db } = opts;
  const warnings: string[] = [];

  const wrapSessionsStopped = await stopWrapSessionsForProject(projectPath);

  let capabilities = opts.capabilities;
  if (!capabilities) {
    const capabilitiesFile = await detectCapabilitiesFile(projectPath);
    if (capabilitiesFile) {
      try {
        capabilities = await parseCapabilitiesFile(
          capabilitiesFile.path,
          capabilitiesFile.format,
        );
      } catch (err) {
        warnings.push(
          `Failed to parse capabilities file: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const resolvedProviders: string[] = resolveProvidersForClean({
    capabilitiesProviders: capabilities?.providers,
    db,
    projectId,
  });
  const providers = providersForOnDiskCleanup(resolvedProviders);

  const managedFiles = db.getManagedFiles(projectId);
  let managedFilesRemoved = 0;
  for (const filePath of managedFiles) {
    if (existsSync(filePath)) {
      try {
        await rm(filePath, { recursive: true, force: true });
        managedFilesRemoved++;
      } catch (err) {
        warnings.push(`Failed to remove ${filePath}: ${err}`);
      }
    }
    db.removeManagedFile(projectId, filePath);
  }

  if (providers.length > 0) {
    try {
      cleanAgentsFile(projectPath, providers);
    } catch (err) {
      warnings.push(
        `Failed to clean agent instructions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const ruleIds = (capabilities?.rules ?? []).map((r) => r.id);
      cleanRules(projectPath, providers, ruleIds);
    } catch (err) {
      warnings.push(
        `Failed to clean rules: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (db.getManagedHooks(projectId).length > 0) {
    const { warnings: hookWarnings } = cleanHooks(projectPath, projectId, db);
    warnings.push(...hookWarnings);
  }

  const lockfilePath = getLockfilePath(projectPath);
  if (existsSync(lockfilePath)) {
    try {
      await rm(lockfilePath, { force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to remove lockfile ${lockfilePath}: ${message}`);
    }
  }

  // Sub-agent files live under provider dirs (e.g. `.cursor/agents`) and are
  // not tracked as managed_files. Remove by id from the DB *and* from the
  // capabilities file so a clean still works when the DB row was already wiped
  // or capabilities.yaml omits `providers:`.
  const agentIds = new Set<string>([
    ...db.getSubAgents(projectId).map((row) => row.agent_id),
    ...(capabilities?.subagents ?? []).map((a) => a.id),
  ]);

  if (providers.length > 0 && agentIds.size > 0) {
    for (const agentId of agentIds) {
      try {
        await unregisterSubAgentMCPServer(projectPath, agentId, providers);
        removeSubAgentInstructions(projectPath, agentId, providers);
      } catch (err) {
        warnings.push(
          `Failed to unregister sub-agent ${agentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (providers.length > 0) {
    try {
      await unregisterMCPServer(projectPath, projectId, providers);
    } catch (err) {
      warnings.push(
        `Failed to unregister MCP server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const workspacesPruned = await pruneWorkspacesForProject(projectPath);

  db.deleteProject(projectId);

  return {
    warnings,
    wrapSessionsStopped,
    workspacesPruned,
    managedFilesRemoved,
  };
}
