import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { getUnexposedToolIds } from './helpers/tool-warnings';

export function configureToolsTask(): Task<InstallCtx> {
  return {
    title: 'Configuring tools',
    task: async (ctx, task) => {
      const tools = ctx.capabilitiesToUse.tools ?? [];
      const mcpTools = tools.filter((t) => t.type === 'mcp');
      const cmdTools = tools.filter((t) => t.type === 'command');
      const mcpServerIds = new Set<string>();
      for (const t of mcpTools) {
        const def = t.def as { server?: string };
        if (def.server) {
          mcpServerIds.add(def.server.startsWith('@') ? def.server.slice(1) : def.server);
        }
      }

      if (tools.length === 0) {
        task.output = 'no tools configured';
      } else {
        const parts: string[] = [];
        if (mcpTools.length > 0) {
          parts.push(
            `${mcpTools.length} MCP tool${mcpTools.length === 1 ? '' : 's'} across ` +
              `${mcpServerIds.size} server${mcpServerIds.size === 1 ? '' : 's'}`,
          );
        }
        if (cmdTools.length > 0) {
          parts.push(`${cmdTools.length} command tool${cmdTools.length === 1 ? '' : 's'}`);
        }
        task.output = `validating ${parts.join(' + ')}…`;
      }

      const response = await fetch(
        `${ctx.serverStatus.url}/api/projects/${ctx.projectId}/configure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ctx.capabilitiesToUse),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to configure project: ${errorText}`);
      }

      task.output = 'parsing validation results…';
      ctx.configureResult = await response.json();

      const result = ctx.configureResult as {
        toolValidation?: Array<{
          toolId: string;
          success: boolean;
          pendingAuth?: boolean;
          serverId?: string;
          remoteTool?: string;
          error?: string;
        }>;
      };

      if (result.toolValidation && result.toolValidation.length > 0) {
        const successful = result.toolValidation.filter((t) => t.success && !t.pendingAuth);
        const failed = result.toolValidation.filter((t) => !t.success && !t.pendingAuth);
        const pendingAuth = result.toolValidation.filter((t) => t.pendingAuth);

        const breakdown: string[] = [];
        if (successful.length > 0) {
          breakdown.push(`✓ ${successful.length} validated`);
        }
        if (pendingAuth.length > 0) {
          const pendingServers = new Set<string>();
          for (const t of pendingAuth) {
            if (t.serverId) pendingServers.add(`@${t.serverId}`);
          }
          const suffix =
            pendingServers.size > 0 ? ` (${[...pendingServers].sort().join(', ')})` : '';
          breakdown.push(`⏳ ${pendingAuth.length} pending OAuth2${suffix}`);
        }
        if (failed.length > 0) {
          breakdown.push(`✗ ${failed.length} failed`);
        }
        task.output = breakdown.join(' · ');

        if (failed.length > 0) {
          ctx.failed += failed.length;
          task.title = `Configuring tools — ${failed.length} of ${result.toolValidation.length} tool(s) failed validation`;
          const lines: string[] = [];
          lines.push(
            `${failed.length} of ${result.toolValidation.length} tool(s) failed validation:`,
          );
          for (const t of failed) {
            lines.push(`  • ${t.toolId}`);
            if (t.serverId && t.remoteTool) {
              lines.push(`      upstream tool "${t.remoteTool}" not found on server "@${t.serverId}"`);
            }
            if (t.error) lines.push(`      ${t.error}`);
          }
          lines.push('  Tip: check that tool names match what the MCP server provides,');
          lines.push('  server IDs are correct (e.g. "@server-name"), and that the MCP');
          lines.push('  servers are reachable.');
          ctx.errors.push(lines.join('\n'));
        } else if (pendingAuth.length > 0 && pendingAuth.length < result.toolValidation.length) {
          task.title = `Configuring tools — ${successful.length} validated, ${pendingAuth.length} pending OAuth2`;
        } else if (pendingAuth.length === 0) {
          task.title = `Configuring tools — ${result.toolValidation.length} validated`;
        }
      }

      // The "tool is not required by any skill" check is meaningless under
      // `toolExposure: 'none'` — capa never exposes any tools to MCP clients
      // in that mode by design (the agent invokes them via `capa sh`), so
      // `requires` lists don't gate anything. Suppress the warning to avoid
      // noise that would push users to "fix" a non-issue.
      const toolExposure = ctx.capabilitiesToUse.options?.toolExposure;
      if (toolExposure !== 'none') {
        const unexposed = getUnexposedToolIds(ctx.capabilitiesToUse);
        if (unexposed.length > 0) {
          ctx.warnings.push(
            `${unexposed.length} tool(s) are not exposed to MCP clients (not required by any skill): ` +
              `${unexposed.sort().join(', ')}. Add them to a skill's \`requires\` list to expose.`,
          );
        }
      }
    },
  };
}
