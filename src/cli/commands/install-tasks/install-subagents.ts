import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Task } from '../../ui';
import { getProvider } from '../../../shared/providers';
import {
  registerSubAgentMCPServer,
  unregisterSubAgentMCPServer,
  purgeCursorSubAgentMCPEntries,
} from '../../utils/mcp-client-manager';
import { installSubAgentInstructions, removeSubAgentInstructions } from '../../utils/agents-file';
import { parseSkillMd } from '../../../shared/skill-md';
import type { Capabilities } from '../../../types/capabilities';
import type { InstallCtx } from './context';

/**
 * For each skill referenced by the active capabilities, read its installed
 * SKILL.md from the first provider whose `skillsDir` contains it, parse the
 * frontmatter, and return a `skillId → description` map.
 *
 * Skills with no SKILL.md on disk (e.g. `installed` / `plugin` types) or a
 * SKILL.md missing the `description` field are silently absent from the map;
 * the renderer falls back to printing the bare skill id.
 */
function buildSkillDescriptions(
  projectPath: string,
  capabilities: Capabilities,
  providers: string[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of capabilities.skills ?? []) {
    for (const pid of providers) {
      const provider = getProvider(pid);
      if (!provider) continue;
      const skillMdPath = join(projectPath, provider.skillsDir, skill.id, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      try {
        const { metadata } = parseSkillMd(readFileSync(skillMdPath, 'utf-8'));
        const desc = metadata.description?.replace(/^["']|["']$/g, '').trim();
        if (desc) {
          map.set(skill.id, desc);
        }
      } catch {
        // Malformed SKILL.md — skip silently; the renderer falls back to id-only.
      }
      break;
    }
  }
  return map;
}

export function installSubagentsTask(): Task<InstallCtx> {
  return {
    title: 'Installing sub-agents',
    enabled: (ctx) => {
      const installedAgents = ctx.db.getSubAgents(ctx.projectId);
      const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
      const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
      const removedSubAgentIds = installedAgents
        .filter(({ agent_id }) => !currentAgentIds.has(agent_id))
        .map(({ agent_id }) => agent_id);
      return removedSubAgentIds.length > 0 || currentSubagents.length > 0;
    },
    task: async (ctx, task) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const toolExposure = ctx.capabilitiesToUse.options?.toolExposure;
      const skipMcpWrites = toolExposure === 'none';
      const installedAgents = ctx.db.getSubAgents(ctx.projectId);
      const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
      const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
      const removedAgents = installedAgents.filter(({ agent_id }) => !currentAgentIds.has(agent_id));

      // Under `toolExposure: 'none'` we also strip *previously-installed*
      // sub-agent MCP entries — having a `capa-<id>` entry pointing at a
      // capa endpoint we said we wouldn't expose is a footgun.
      const agentsNeedingMcpCleanup = skipMcpWrites
        ? installedAgents.map(({ agent_id }) => agent_id)
        : removedAgents.map(({ agent_id }) => agent_id);

      // Purge stale sub-agent MCP entries for providers that need a sweep
      // (Cursor doesn't model per-sub-agent entries — its `capa-<id>` entries
      // can only be cleaned by `purgeCursorSubAgentMCPEntries`). This must
      // run under `toolExposure: 'none'` too: that's *exactly* the case where
      // every previously-registered `capa-<id>` entry is now stale and
      // contradicts the "no .mcp writes" contract. The per-sub-agent
      // unregister loop below is a no-op for those providers, so without
      // this purge their entries would linger forever.
      const needsPurge = providers.some((id) => {
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
        await purgeCursorSubAgentMCPEntries(ctx.projectPath);
      }

      // Drop MCP entries for any sub-agent that needs them gone — either
      // because the agent itself was removed from the capabilities file, or
      // because `toolExposure: 'none'` rescinds MCP wiring entirely.
      const cleanupSet = new Set(agentsNeedingMcpCleanup);
      for (const { agent_id } of removedAgents) {
        step++;
        task.output = `[${step}/${total}] removing ${agent_id}`;
        await unregisterSubAgentMCPServer(ctx.projectPath, agent_id, providers);
        removeSubAgentInstructions(ctx.projectPath, agent_id, providers);
        ctx.db.removeSubAgent(ctx.projectId, agent_id);
        cleanupSet.delete(agent_id);
      }
      for (const agent_id of cleanupSet) {
        await unregisterSubAgentMCPServer(ctx.projectPath, agent_id, providers);
      }

      for (const subAgent of currentSubagents) {
        step++;
        task.output = `[${step}/${total}] ${subAgent.id}`;
        if (!skipMcpWrites) {
          const agentMcpUrl = `${ctx.serverStatus.url}/${ctx.projectId}/agents/${subAgent.id}/mcp`;
          await registerSubAgentMCPServer(ctx.projectPath, subAgent.id, agentMcpUrl, providers);
        }
        // Instructions are still informative even without MCP wiring — they
        // describe the agent's purpose. The agent file itself encodes the
        // expected MCP server key, but missing entries simply mean those
        // tools won't be available to that sub-agent (an explicit choice).
        installSubAgentInstructions(
          ctx.projectPath,
          subAgent,
          ctx.capabilitiesToUse,
          providers,
          skillDescriptions
        );
        ctx.db.upsertSubAgent(ctx.projectId, subAgent.id);
        ctx.added++;
      }

      const installed = currentSubagents.length;
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
