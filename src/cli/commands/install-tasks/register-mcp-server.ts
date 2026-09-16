import type { Task } from '../../ui';
import { registerMCPServer, unregisterMCPServer } from '../../utils/mcp-client-manager';
import { needsCapaMcpEntry } from '../../../shared/server-tool-exposure';
import type { InstallCtx } from './context';

export function registerMcpServerTask(): Task<InstallCtx> {
  return {
    title: 'Registering MCP server',
    task: async (ctx, task) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const toolExposure = ctx.capabilitiesToUse.options?.toolExposure;

      // `toolExposure: 'none'` is an explicit opt-out from MCP wiring — the
      // agent is expected to discover/run tools via `capa sh` instead. We
      // still call `unregisterMCPServer` to clean up any entry left behind
      // by a previous install under a different mode.
      if (toolExposure === 'none') {
        await unregisterMCPServer(ctx.projectPath, ctx.projectId, providers);
        task.title = 'MCP registration skipped (toolExposure: none)';
        return;
      }

      if (needsCapaMcpEntry(ctx.capabilitiesToUse)) {
        await registerMCPServer(ctx.projectPath, ctx.projectId, ctx.mcpUrl, providers);
      } else {
        await unregisterMCPServer(ctx.projectPath, ctx.projectId, providers);
      }
    },
  };
}
