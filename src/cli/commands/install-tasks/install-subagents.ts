import type { Task } from '../../ui';
import { getProvider } from '../../../shared/providers';
import {
  registerSubAgentMCPServer,
  unregisterSubAgentMCPServer,
  purgeCursorSubAgentMCPEntries,
} from '../../utils/mcp-client-manager';
import { installSubAgentInstructions, removeSubAgentInstructions } from '../../utils/agents-file';
import type { InstallCtx } from './context';

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
      const installedAgents = ctx.db.getSubAgents(ctx.projectId);
      const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
      const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
      const removedAgents = installedAgents.filter(({ agent_id }) => !currentAgentIds.has(agent_id));

      const needsPurge = providers.some((id) => {
        const provider = getProvider(id);
        return (
          provider &&
          (provider.mcp?.supportsSubAgentEntries === false || provider.purgeStaleSubAgentMcp === true)
        );
      });

      const total = (needsPurge ? 1 : 0) + removedAgents.length + currentSubagents.length;
      let step = 0;

      if (needsPurge) {
        step++;
        task.output = `[${step}/${total}] purging stale sub-agent MCP entries`;
        await purgeCursorSubAgentMCPEntries(ctx.projectPath);
      }

      for (const { agent_id } of removedAgents) {
        step++;
        task.output = `[${step}/${total}] removing ${agent_id}`;
        await unregisterSubAgentMCPServer(ctx.projectPath, agent_id, providers);
        removeSubAgentInstructions(ctx.projectPath, agent_id, providers);
        ctx.db.removeSubAgent(ctx.projectId, agent_id);
      }

      for (const subAgent of currentSubagents) {
        step++;
        task.output = `[${step}/${total}] ${subAgent.id}`;
        const agentMcpUrl = `${ctx.serverStatus.url}/${ctx.projectId}/agents/${subAgent.id}/mcp`;
        await registerSubAgentMCPServer(ctx.projectPath, subAgent.id, agentMcpUrl, providers);
        installSubAgentInstructions(ctx.projectPath, subAgent, ctx.capabilitiesToUse, providers);
        ctx.db.upsertSubAgent(ctx.projectId, subAgent.id);
        ctx.added++;
      }

      const installed = currentSubagents.length;
      task.title = installed > 0
        ? `Installed ${installed} sub-agent${installed === 1 ? '' : 's'}`
        : 'Sub-agents up to date';
    },
  };
}
