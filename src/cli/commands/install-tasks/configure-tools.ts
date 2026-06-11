import type { Task, TaskWrapper } from '../../ui';
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
          headers: {
            'Content-Type': 'application/json',
            // Ask the server to stream NDJSON progress so we can render a
            // live "X of Y validated · last-server done" counter instead of
            // a static spinner. The server falls back to a single JSON
            // body if it doesn't support streaming.
            Accept: 'application/x-ndjson, application/json',
          },
          body: JSON.stringify(ctx.capabilitiesToUse),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to configure project: ${errorText}`);
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType.includes('application/x-ndjson') && response.body) {
        ctx.configureResult = await consumeConfigureStream(response.body, task);
      } else {
        task.output = 'parsing validation results…';
        ctx.configureResult = await response.json();
      }

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

/**
 * Consume an NDJSON progress stream from `POST /api/projects/:id/configure`,
 * updating the task spinner as the server fans out OAuth2 detection and
 * tool validation. Returns the body of the terminal `result` event, which
 * is the same shape the non-streaming endpoint returned in a single JSON
 * payload — so callers don't need to know which path produced it.
 */
async function consumeConfigureStream(
  body: ReadableStream<Uint8Array>,
  task: TaskWrapper,
): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Record<string, unknown> | null = null;

  const fmt = (state: ProgressState): string => {
    const parts: string[] = [];
    if (state.totalOauth2 > 0 && state.oauth2Done < state.totalOauth2) {
      parts.push(`OAuth2 ${state.oauth2Done}/${state.totalOauth2}`);
    }
    if (state.totalTools > 0) {
      parts.push(`${state.validated}/${state.totalTools} validated`);
    }
    if (state.lastServerId) {
      parts.push(`${state.lastServerId} ✓`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'validating…';
  };

  const state: ProgressState = {
    totalOauth2: 0,
    oauth2Done: 0,
    totalTools: 0,
    validated: 0,
    lastServerId: '',
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    switch (event.type) {
      case 'oauth2_init':
        state.totalOauth2 = event.totalServers ?? 0;
        if (state.totalOauth2 > 0) {
          task.output = fmt(state);
        }
        return;
      case 'oauth2_done':
        state.oauth2Done = event.done ?? state.oauth2Done + 1;
        task.output = fmt(state);
        return;
      case 'validation_init':
        state.totalTools = event.totalTools ?? 0;
        state.validated = event.commandTools ?? 0;
        task.output = fmt(state);
        return;
      case 'server_done':
        state.validated = event.validated ?? state.validated;
        state.lastServerId = event.serverId ?? state.lastServerId;
        task.output = fmt(state);
        return;
      case 'result': {
        const { type: _type, ...rest } = event;
        result = rest;
        return;
      }
      case 'error':
        throw new Error(event.error ?? 'configure failed');
      default:
        return;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      handleLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) {
    handleLine(buffer);
  }

  if (result === null) {
    throw new Error('configure stream ended without a result event');
  }
  return result;
}

interface ProgressState {
  totalOauth2: number;
  oauth2Done: number;
  totalTools: number;
  validated: number;
  lastServerId: string;
}
