import type { Tool, ToolSchema } from '../../../../types/api';
import { matchesSearch } from '../../../../lib/utils';

export interface ToolLink {
  fromKey: string;
  toKey: string;
}

/** Stable DOM/link identity for a configured MCP tool (survives duplicate ids). */
export function configuredToolAnchor(tool: {
  id: string;
  mcpServer?: string | null;
  mcpTool?: string | null;
}): string {
  if (tool.mcpServer && tool.mcpTool) {
    const serverId = tool.mcpServer.replace(/^@/, '');
    return `cfg:${tool.id}::${serverId}::${tool.mcpTool}`;
  }
  return `cfg:${tool.id}`;
}

export function remoteToolAnchor(serverId: string, toolName: string): string {
  return `remote:${serverId}::${toolName}`;
}

export function serverAnchor(serverId: string): string {
  return `server:${serverId}`;
}

export function findAnchorEl(root: HTMLElement, key: string): HTMLElement | null {
  const nodes = root.querySelectorAll('[data-link-anchor]');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.getAttribute('data-link-anchor') === key && node instanceof HTMLElement) {
      return node;
    }
  }
  return null;
}

export function filterLinksForFocus(
  links: ToolLink[],
  focusedAnchor: string | null,
  tools: Tool[],
): ToolLink[] {
  if (!focusedAnchor) return links;

  if (focusedAnchor.startsWith('cfg:')) {
    return links.filter((l) => l.toKey === focusedAnchor);
  }

  if (focusedAnchor.startsWith('remote:')) {
    const rest = focusedAnchor.slice('remote:'.length);
    const sep = rest.indexOf('::');
    if (sep < 0) return [];
    const serverId = rest.slice(0, sep);
    const mcpTool = rest.slice(sep + 2);
    const match = tools.find(
      (t) =>
        t.type === 'mcp' &&
        (t.mcpServer || '').replace(/^@/, '') === serverId &&
        t.mcpTool === mcpTool,
    );
    if (!match) return [];
    const toKey = configuredToolAnchor(match);
    return links.filter((l) => l.toKey === toKey);
  }

  if (focusedAnchor.startsWith('tool:')) {
    const id = focusedAnchor.slice('tool:'.length);
    const match = tools.find((t) => t.id === id);
    if (!match) return [];
    const toKey = configuredToolAnchor(match);
    return links.filter((l) => l.toKey === toKey);
  }

  return [];
}

export function suggestConfiguredToolId(
  serverId: string,
  toolName: string,
  existingIds: Set<string>,
): string {
  const safeTool = toolName.replace(/[^a-zA-Z0-9_]/g, '_') || 'tool';
  const safeServer = serverId.replace(/[^a-zA-Z0-9_]/g, '_') || 'server';
  const preferred = `${safeServer}_${safeTool}`;
  if (!existingIds.has(preferred)) return preferred;
  if (!existingIds.has(safeTool)) return safeTool;
  let n = 2;
  while (existingIds.has(`${preferred}_${n}`)) n += 1;
  return `${preferred}_${n}`;
}

export function toolMatchesSearch(tool: ToolSchema, query: string): boolean {
  const paramTexts = Object.entries(tool.inputSchema?.properties || {}).flatMap(
    ([name, s]) => [name, s.description || ''],
  );
  return matchesSearch([tool.name, tool.description, ...paramTexts], query);
}

export function isToolFocused(tool: Tool, focusedAnchor: string | null): boolean {
  if (!focusedAnchor) return false;
  if (focusedAnchor === configuredToolAnchor(tool)) return true;
  if (focusedAnchor === `tool:${tool.id}`) return true;
  if (
    focusedAnchor.startsWith('remote:') &&
    tool.type === 'mcp' &&
    tool.mcpServer &&
    tool.mcpTool
  ) {
    return focusedAnchor === remoteToolAnchor(tool.mcpServer.replace(/^@/, ''), tool.mcpTool);
  }
  return false;
}

/** Clamp a link endpoint Y to its scroll panel's visible bounds (root-local coords). */
export function clipYToPanel(
  el: HTMLElement,
  y: number,
  rootRect: DOMRect,
): { y: number; inView: boolean } {
  const panel = el.closest('[data-tools-panel-scroll]');
  if (!(panel instanceof HTMLElement)) {
    return { y, inView: true };
  }
  const clip = panel.getBoundingClientRect();
  const minY = clip.top - rootRect.top;
  const maxY = clip.bottom - rootRect.top;
  const inView = y >= minY && y <= maxY;
  return {
    y: Math.min(maxY, Math.max(minY, y)),
    inView,
  };
}
