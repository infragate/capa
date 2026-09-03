import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Task } from '../../ui';
import { getProvider } from '../../../shared/providers';
import { assertSafeRepoPath } from '../../../shared/repo-file';
import { isSafeCapabilityId } from '../../../shared/safe-id';
import {
  registerSubAgentMCPServer,
  unregisterSubAgentMCPServer,
  purgeCursorSubAgentMCPEntries,
} from '../../utils/mcp-client-manager';
import { installSubAgentInstructions, removeSubAgentInstructions } from '../../utils/agents-file/index';
import { parseSkillMd } from '../../../shared/skill-md';
import type { Capabilities } from '../../../types/capabilities';
import {
  getSubAgentProviderWarnings,
  resolvePreviousSubAgentProviders,
  resolveSubAgentProviders,
} from '../../../shared/subagent-providers';
import { canonicalizePath } from '../../../shared/paths';
import type { InstalledSubAgent } from '../../../db/sub-agents';
import type { InstallCtx } from './context';
import { materialInstallProviders } from './helpers/install-providers';

function providersInstalledAt(
  agent: InstalledSubAgent,
  installPath: string,
): string[] | undefined {
  return agent.installations.find(
    (installation) => installation.install_path === installPath,
  )?.provider_ids;
}

/**
 * Strip a single pair of matching surrounding quotes (either `"` or `'`).
 * Conservative on purpose: `He said "hi"` keeps both quotes; only `"foo"` or
 * `'foo'` are unwrapped.
 */
function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  if ((first === '"' || first === "'") && value[value.length - 1] === first) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * For each skill referenced by the active capabilities, read its installed
 * SKILL.md from the first provider whose `skillsDir` contains a valid copy,
 * parse the frontmatter, and return a `skillId → description` map.
 *
 * Skills with no SKILL.md on disk (e.g. `installed` / `plugin` types) or a
 * SKILL.md missing the `description` field are silently absent from the map;
 * the renderer falls back to printing the bare skill id. A malformed SKILL.md
 * in one provider's dir does NOT block us from trying another provider's copy.
 */
export function buildSkillDescriptions(
  projectPath: string,
  capabilities: Capabilities,
  providers: string[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of capabilities.skills ?? []) {
    if (!isSafeCapabilityId(skill.id)) continue;
    for (const pid of providers) {
      const provider = getProvider(pid);
      if (!provider) continue;
      let skillMdPath: string;
      try {
        skillMdPath = join(
          assertSafeRepoPath(join(projectPath, provider.skillsDir), skill.id),
          'SKILL.md',
        );
      } catch {
        continue;
      }
      if (!existsSync(skillMdPath)) continue;
      try {
        const { metadata } = parseSkillMd(readFileSync(skillMdPath, 'utf-8'));
        const desc = metadata.description ? stripSurroundingQuotes(metadata.description).trim() : '';
        if (desc) {
          map.set(skill.id, desc);
        }
        // Successful parse — stop searching providers for this skill, whether
        // or not a description was present (all providers receive the same
        // SKILL.md content from install, so the answer is consistent).
        break;
      } catch {
        // Malformed SKILL.md — try the next provider instead of giving up
        // (another provider's copy might be intact).
      }
    }
  }
  return map;
}

export function installSubagentsTask(): Task<InstallCtx> {
  return {
    title: 'Installing sub-agents',
    enabled: (ctx) => {
      const installedAgents = ctx.db.getSubAgents(ctx.projectId);
      const installPath = canonicalizePath(ctx.projectPath);
      const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
      const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
      const removedSubAgentIds = installedAgents
        .filter(
          (agent) =>
            !currentAgentIds.has(agent.agent_id) &&
            (agent.legacy_unscoped || providersInstalledAt(agent, installPath)),
        )
        .map(({ agent_id }) => agent_id);
      return removedSubAgentIds.length > 0 || currentSubagents.length > 0;
    },
    task: async (ctx, task) => {
      const providers = materialInstallProviders(ctx);
      const installPath = canonicalizePath(ctx.projectPath);
      const toolExposure = ctx.capabilitiesToUse.options?.toolExposure;
      const skipMcpWrites = toolExposure === 'none';
      const installedAgents = ctx.db.getSubAgents(ctx.projectId);
      const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
      const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
      const removedAgents = installedAgents.filter(
        (agent) =>
          !currentAgentIds.has(agent.agent_id) &&
          (agent.legacy_unscoped || providersInstalledAt(agent, installPath)),
      );
      const installedById = new Map(installedAgents.map((agent) => [agent.agent_id, agent]));
      const lifecycleProviders = [
        ...new Set([
          ...providers,
          ...installedAgents.flatMap(
            (installedAgent) =>
              resolvePreviousSubAgentProviders({
                installedAgent,
                installPath,
                activeProviders: providers,
                previousProjectProviders: ctx.previousProviders,
                isWrapInstall: ctx.isWrapInstall,
              }),
          ),
        ]),
      ];

      // Purge stale sub-agent MCP entries for providers that need a sweep
      // (Cursor doesn't model per-sub-agent entries — its `capa-<id>` entries
      // can only be cleaned by `purgeCursorSubAgentMCPEntries`). This must
      // run under `toolExposure: 'none'` too: that's *exactly* the case where
      // every previously-registered `capa-<id>` entry is now stale and
      // contradicts the "no .mcp writes" contract. The per-sub-agent
      // unregister loop below is a no-op for those providers, so without
      // this purge their entries would linger forever.
      const needsPurge = lifecycleProviders.some((id) => {
        const provider = getProvider(id);
        return (
          provider &&
          (provider.mcp?.supportsSubAgentEntries === false || provider.purgeStaleSubAgentMcp === true)
        );
      });

      // Built once before the loop — by the time we run, installSkillsTask
      // has already materialised every SKILL.md under each provider's
      // skillsDir, so we can pull descriptions from frontmatter directly.
      const skillDescriptions = buildSkillDescriptions(
        ctx.projectPath,
        ctx.capabilitiesToUse,
        providers
      );

      const total = (needsPurge ? 1 : 0) + removedAgents.length + currentSubagents.length;
      let step = 0;

      if (needsPurge) {
        step++;
        task.output = `[${step}/${total}] purging stale sub-agent MCP entries`;
        await purgeCursorSubAgentMCPEntries(ctx.projectPath, ctx.projectId);
      }

      for (const installedAgent of removedAgents) {
        const { agent_id } = installedAgent;
        const previousProviders = resolvePreviousSubAgentProviders({
          installedAgent,
          installPath,
          activeProviders: providers,
          previousProjectProviders: ctx.previousProviders,
          isWrapInstall: ctx.isWrapInstall,
        });
        step++;
        task.output = `[${step}/${total}] removing ${agent_id}`;
        await unregisterSubAgentMCPServer(
          ctx.projectPath,
          agent_id,
          previousProviders,
          ctx.projectId,
        );
        removeSubAgentInstructions(ctx.projectPath, agent_id, previousProviders);
        ctx.db.removeSubAgentInstallation(
          ctx.projectId,
          agent_id,
          {
            installPath,
            removeLegacy: !ctx.isWrapInstall,
          },
        );
      }

      let installed = 0;
      for (const subAgent of currentSubagents) {
        step++;
        task.output = `[${step}/${total}] ${subAgent.id}`;
        const targets = resolveSubAgentProviders(
          subAgent,
          providers,
        );
        const { supported } = targets;
        ctx.warnings.push(...getSubAgentProviderWarnings(subAgent, targets));

        const previous = installedById.get(subAgent.id);
        const previousProviders = previous
          ? resolvePreviousSubAgentProviders({
              installedAgent: previous,
              installPath,
              activeProviders: providers,
              previousProjectProviders: ctx.previousProviders,
              isWrapInstall: ctx.isWrapInstall,
            })
          : [];
        const staleProviders = previousProviders.filter(
          (providerId) => !supported.includes(providerId),
        );
        if (staleProviders.length > 0) {
          await unregisterSubAgentMCPServer(
            ctx.projectPath,
            subAgent.id,
            staleProviders,
            ctx.projectId,
          );
          removeSubAgentInstructions(ctx.projectPath, subAgent.id, staleProviders);
        }

        if (skipMcpWrites) {
          await unregisterSubAgentMCPServer(
            ctx.projectPath,
            subAgent.id,
            supported,
            ctx.projectId,
          );
        } else {
          const agentMcpUrl = `${ctx.serverStatus.url}/${ctx.projectId}/agents/${subAgent.id}/mcp`;
          await registerSubAgentMCPServer(ctx.projectPath, subAgent.id, agentMcpUrl, supported);
        }
        installSubAgentInstructions(
          ctx.projectPath,
          subAgent,
          ctx.capabilitiesToUse,
          supported,
          skillDescriptions
        );
        ctx.db.upsertSubAgent(
          ctx.projectId,
          subAgent.id,
          {
            installPath,
            providerIds: supported,
            migrateLegacy: !ctx.isWrapInstall,
          },
        );
        if (supported.length > 0) {
          installed++;
          ctx.added++;
        } else {
          ctx.skipped++;
        }
      }

      if (skipMcpWrites && installed > 0) {
        task.title = `Installed ${installed} sub-agent${installed === 1 ? '' : 's'} (no MCP wiring — toolExposure: none)`;
      } else {
        task.title = installed > 0
          ? `Installed ${installed} sub-agent${installed === 1 ? '' : 's'}`
          : 'Sub-agents up to date';
      }
    },
  };
}
