import type { Task } from '../../ui';
import { registerMCPServer, unregisterMCPServer } from '../../utils/mcp-client-manager';
import type { InstallCtx } from './context';

export function registerMcpServerTask(): Task<InstallCtx> {
  return {
    title: 'Registering MCP server',
    task: async (ctx) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const hasTools = ctx.capabilitiesToUse.tools.length > 0;
      const hasSubagents = (ctx.capabilitiesToUse.subagents ?? []).length > 0;
      if (hasTools || hasSubagents) {
        await registerMCPServer(ctx.projectPath, ctx.projectId, ctx.mcpUrl, providers);
      } else {
        await unregisterMCPServer(ctx.projectPath, ctx.projectId, providers);
      }
    },
  };
}
