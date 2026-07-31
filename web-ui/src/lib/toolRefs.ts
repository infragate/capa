import type { Tool } from '../types/api';

/**
 * Canonical `skills[].def.requires` entry for a configured tool.
 * MCP: `@<server-id>.<tool-id>`  ·  command: `<tool-id>`
 */
export function skillRequiresRef(tool: Tool): string {
  if (tool.type === 'mcp' && tool.mcpServer) {
    const serverId = tool.mcpServer.replace(/^@/, '');
    return `@${serverId}.${tool.id}`;
  }
  return tool.id;
}

/** True if a requires/tools ref points at this configured tool (any accepted dialect). */
export function refMatchesTool(ref: string, tool: Tool): boolean {
  const stripped = ref.startsWith('@') ? ref.slice(1) : ref;
  if (stripped === tool.id) return true;

  if (tool.type === 'mcp' && tool.mcpServer) {
    const serverId = tool.mcpServer.replace(/^@/, '');
    if (stripped === `${serverId}.${tool.id}`) return true;
    if (tool.mcpTool && stripped === `${serverId}.${tool.mcpTool}`) return true;
  }

  if (tool.type === 'command' && tool.group && stripped === `${tool.group}.${tool.id}`) {
    return true;
  }

  return false;
}

export function skillRequiresTool(requires: string[] | undefined, tool: Tool): boolean {
  return (requires || []).some((ref) => refMatchesTool(ref, tool));
}

/** Drop every dialect that points at this tool, then optionally add the canonical ref. */
export function withSkillRequiresTool(
  requires: string[] | undefined,
  tool: Tool,
  include: boolean,
): string[] {
  const without = (requires || []).filter((ref) => !refMatchesTool(ref, tool));
  if (!include) return without;
  const canonical = skillRequiresRef(tool);
  return without.includes(canonical) ? without : [...without, canonical];
}
