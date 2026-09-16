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
}

const serverIdOf = (tool: Tool) => (tool.mcpServer ?? '').replace(/^@/, '');

/** Tools authored in the `tools:` section (not synthesized from an expose policy). */
export function authoredTools(tools: Tool[]): Tool[] {
  return tools.filter((tool) => !tool.fromServerExpose);
}

/**
 * Effective exposure for each server. Synthesized tools (resolved by the
 * server from the live tool list) are the source of truth for policy modes;
 * authored MCP entries define curated servers.
 */
export function computeServerExposure(
  servers: Server[],
  tools: Tool[],
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
    const curated = authored.get(server.id);
    if (curated) {
      result[server.id] = { mode: 'curated', exposedToolNames: curated };
      continue;
    }
    const mode = server.expose ?? 'all';
    result[server.id] = {
      mode,
      exposedToolNames: mode === 'none' ? new Set() : (synthesized.get(server.id) ?? new Set()),
    };
  }
  return result;
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
