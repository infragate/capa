import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { join, resolve } from 'path';
import { isCapaOwnedInstallPath } from '../../shared/install-path-guard';
import { isUnderWrapWorkspacesDir } from '../../shared/workspaces/paths';
import { canonicalizePath, detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { getLockfilePath } from '../../shared/lockfile';
import { resolveProvidersForClean } from '../../shared/providers/resolve';
import { getAllProviders, getProvider } from '../../shared/providers';
import {
  resolvePreviousSubAgentProviders,
  resolveSubAgentProviders,
} from '../../shared/subagent-providers';
import type { CapaDatabase } from '../../db/database';
import type { Capabilities } from '../../types/capabilities';
import {
  purgeCursorSubAgentMCPEntries,
  unregisterMCPServer,
  unregisterSubAgentMCPServer,
} from '../utils/mcp-client-manager';
import { cleanAgentsFile, removeSubAgentInstructions } from '../utils/agents-file/index';
import { cleanRules } from '../utils/rules-installer';
import { cleanHooks } from '../utils/hooks';
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
  skillDirsRemoved: number;
}

/**
 * When capabilities.yaml omits `providers:` and the DB row is already gone,
 * still sweep every provider that owns on-disk agent/rule artifacts so clean
 * can remove leftover files from a previous install.
 */
function providersForOnDiskCleanup(resolved: string[]): string[] {
  if (resolved.length > 0) return resolved;
  return getAllProviders()
    .filter((p) => p.subagents || p.rules || p.instructions || p.mcp || p.skillsDir)
    .map((p) => p.id);
}

/**
 * Remove skill install directories declared in capabilities for each active
 * provider (e.g. `.cursor/skills/<id>`). Mirrors sub-agent cleanup: covers
 * orphaned dirs when install wrote files but never recorded managed_files.
 */
async function cleanSkillInstallDirs(
  projectPath: string,
  providers: string[],
  skillIds: string[],
  warnings: string[],
): Promise<number> {
  let removed = 0;
  if (skillIds.length === 0 || providers.length === 0) return removed;

  const skippedProviderRoots = new Set<string>();

  for (const providerId of providers) {
    const provider = getProvider(providerId);
    if (!provider?.skillsDir) continue;

    const skillsRoot = join(projectPath, provider.skillsDir);
    if (!isCapaOwnedInstallPath(projectPath, skillsRoot)) {
      if (!skippedProviderRoots.has(skillsRoot)) {
        skippedProviderRoots.add(skillsRoot);
        warnings.push(
          `Skipped skill cleanup under ${provider.skillsDir}: not a capa-owned path ` +
            `(often a symlink to project source — e.g. .cursor/skills → ../skills).`,
        );
      }
      continue;
    }

    for (const skillId of skillIds) {
      const skillDir = join(skillsRoot, skillId);
      if (!existsSync(skillDir)) continue;
      if (!isCapaOwnedInstallPath(projectPath, skillDir)) continue;
      try {
        await rm(skillDir, { recursive: true, force: true });
        removed++;
      } catch (err) {
        warnings.push(
          `Failed to remove skill directory ${skillDir}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return removed;
}

/** Managed artifacts recorded under the real project tree (not wrap shadow paths). */
function managedFilesOnRealProject(
  projectPath: string,
  managedFiles: string[],
): string[] {
  const root = resolve(projectPath);
  return managedFiles.filter((filePath) => {
    const abs = resolve(filePath);
    if (isUnderWrapWorkspacesDir(abs)) return false;
    return abs === root || abs.startsWith(root + '/');
  });
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
  const storedProviders = db.getProjectProviders(projectId);
  const providers = providersForOnDiskCleanup(resolvedProviders);

  const managedFiles = db.getManagedFiles(projectId);
  const realManagedFiles = managedFilesOnRealProject(projectPath, managedFiles);
  const wrapOnlyManagedArtifacts =
    managedFiles.length > 0 && realManagedFiles.length === 0;

  const skillIds = (capabilities?.skills ?? []).map((s) => s.id);
  const skillDirsRemoved = wrapOnlyManagedArtifacts
    ? 0
    : await cleanSkillInstallDirs(projectPath, providers, skillIds, warnings);

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

  if (providers.length > 0 && !wrapOnlyManagedArtifacts) {
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

  if (!wrapOnlyManagedArtifacts && db.getManagedHooks(projectId).length > 0) {
    const { warnings: hookWarnings } = cleanHooks(projectPath, projectId, db);
    warnings.push(...hookWarnings);
  } else if (wrapOnlyManagedArtifacts && db.getManagedHooks(projectId).length > 0) {
    db.clearManagedHooks(projectId);
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
  const installedAgents = db.getSubAgents(projectId);
  const installedAgentsById = new Map(
    installedAgents.map((agent) => [agent.agent_id, agent]),
  );
  const installPath = canonicalizePath(projectPath);
  const configuredAgentsById = new Map(
    (capabilities?.subagents ?? []).map((agent) => [agent.id, agent]),
  );
  const agentIds = new Set<string>([
    ...installedAgentsById.keys(),
    ...configuredAgentsById.keys(),
  ]);

  if (providers.length > 0 && agentIds.size > 0 && !wrapOnlyManagedArtifacts) {
    try {
      await purgeCursorSubAgentMCPEntries(projectPath, projectId);
    } catch (err) {
      warnings.push(
        `Failed to purge stale sub-agent MCP entries: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    for (const agentId of agentIds) {
      try {
        const installedAgent = installedAgentsById.get(agentId);
        const configuredAgent = configuredAgentsById.get(agentId);
        const agentProviders = installedAgent
          ? resolvePreviousSubAgentProviders({
              installedAgent,
              installPath,
              activeProviders: providers,
              previousProjectProviders: storedProviders,
              isWrapInstall: false,
            })
          : configuredAgent
            ? resolveSubAgentProviders(configuredAgent, providers).supported
            : providers;
        if (agentProviders.length === 0) continue;
        await unregisterSubAgentMCPServer(
          projectPath,
          agentId,
          agentProviders,
          projectId,
        );
        removeSubAgentInstructions(projectPath, agentId, agentProviders);
      } catch (err) {
        warnings.push(
          `Failed to unregister sub-agent ${agentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (providers.length > 0 && !wrapOnlyManagedArtifacts) {
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
    skillDirsRemoved,
  };
}
