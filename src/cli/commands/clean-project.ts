import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { getLockfilePath } from '../../shared/lockfile';
import { resolveProvidersForClean } from '../../shared/providers/resolve';
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

  const providers: string[] = resolveProvidersForClean({
    capabilitiesProviders: capabilities?.providers,
    db,
    projectId,
  });

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

  if (providers.length > 0) {
    const installedSubAgents = db.getSubAgents(projectId);
    for (const { agent_id } of installedSubAgents) {
      try {
        await unregisterSubAgentMCPServer(projectPath, agent_id, providers);
        removeSubAgentInstructions(projectPath, agent_id, providers);
      } catch (err) {
        warnings.push(
          `Failed to unregister sub-agent ${agent_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

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
