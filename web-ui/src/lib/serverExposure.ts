import type { Server, Tool } from '../types/api';

/**
 * How a server's tools reach agents:
 *  - `curated`: the Tools section declares entries for this server, so only
 *    those are exposed and the server's `expose` policy is ignored.
 *  - `all` / `except` / `exactly` / `none`: the server's `expose` policy
 *    (omitted means `all`).
 */
export type ServerExposureMode = 'curated' | 'all' | 'except' | 'exactly' | 'none';

export interface ServerExposure {
  mode: ServerExposureMode;
  /** Remote tool names agents can use through capa. */
  exposedToolNames: Set<string>;
  /** Number of tools the server advertised, or null when its tool list is unavailable. */
  totalTools: number | null;
}

const serverIdOf = (tool: Tool) => (tool.mcpServer ?? '').replace(/^@/, '');

/** Tools authored in the `tools:` section (not synthesized from an expose policy). */
export function authoredTools(tools: Tool[]): Tool[] {
  return tools.filter((tool) => !tool.fromServerExpose);
}

/**
 * Effective exposure for each server. Authored MCP entries define curated
 * servers. For policy servers, the policy is applied to the server's live tool
 * list when the UI has it; otherwise the tools the server synthesized at its
 * last configure are used.
 *
 * @param liveToolNames - remote tool names per server id, only for servers
 *   whose tool list loaded successfully.
 */
export function computeServerExposure(
  servers: Server[],
  tools: Tool[],
  liveToolNames: Record<string, string[]> = {},
): Record<string, ServerExposure> {
  const authored = new Map<string, Set<string>>();
  const synthesized = new Map<string, Set<string>>();
  for (const tool of tools) {
    if (tool.type !== 'mcp' || !tool.mcpServer || !tool.mcpTool) continue;
    const target = tool.fromServerExpose ? synthesized : authored;
    const id = serverIdOf(tool);
    if (!target.has(id)) target.set(id, new Set());
    target.get(id)!.add(tool.mcpTool);
  }

  const result: Record<string, ServerExposure> = {};
  for (const server of servers) {
    const live = liveToolNames[server.id];
    const totalTools = live ? live.length : null;
    const curated = authored.get(server.id);
    if (curated) {
      result[server.id] = { mode: 'curated', exposedToolNames: curated, totalTools };
      continue;
    }
    const mode = server.expose ?? 'all';
    let exposedToolNames: Set<string>;
    if (mode === 'none') {
      exposedToolNames = new Set();
    } else if (live) {
      exposedToolNames = new Set(applyExposePolicy(mode, server.exposeTools ?? [], live));
    } else {
      exposedToolNames = synthesized.get(server.id) ?? new Set();
    }
    result[server.id] = { mode, exposedToolNames, totalTools };
  }
  return result;
}

/** Same selection the server makes when synthesizing tools from a policy. */
function applyExposePolicy(
  mode: 'all' | 'except' | 'exactly',
  named: string[],
  remoteNames: string[],
): string[] {
  const listed = new Set(named);
  if (mode === 'except') return remoteNames.filter((n) => !listed.has(n));
  if (mode === 'exactly') return remoteNames.filter((n) => listed.has(n));
  return remoteNames;
}

/**
 * Adding the first `tools:` entry for a server that currently exposes tools
 * through its policy switches it to a curated list, hiding its other tools.
 */
export function addingToolCuratesServer(exposure: ServerExposure | undefined): boolean {
  return !!exposure && exposure.mode !== 'curated' && exposure.mode !== 'none';
}

/** `requires:` on skills only drives which tools are exposed outside `search` mode. */
export function skillRequiresApplies(toolExposure: string | null | undefined): boolean {
  return effectiveToolExposure(toolExposure) !== 'search';
}

/** The server treats an omitted `options.toolExposure` as `expose-all`. */
export function effectiveToolExposure(toolExposure: string | null | undefined): string {
  return toolExposure || 'expose-all';
}

/**
 * Tools whose schemas count toward the token-savings "with capa" cost. Only
 * `expose-all` lists policy-exposed tools up front; `search` and `on-demand`
 * keep them behind meta-tools, so only authored entries are counted there.
 */
export function toolsForTokenSavings(toolExposure: string | null | undefined, tools: Tool[]): Tool[] {
  return effectiveToolExposure(toolExposure) === 'expose-all' ? tools : authoredTools(tools);
}
