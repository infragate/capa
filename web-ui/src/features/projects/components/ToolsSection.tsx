import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronRight,
  Trash2,
  Lock,
  Plus,
  Check,
  X,
  Loader2,
  Link2,
  Unlink,
  Pencil,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTool, Server, Skill, Tool, ToolSchema } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { Spinner } from '../../../components/common/Spinner';
import {
  useAppendCapability,
  useDeleteCapability,
  useDisconnectOAuth,
  useReorderCapability,
  useStartOAuth,
  useUpdateCapability,
} from '../hooks';
import { useQueries } from '@tanstack/react-query';
import { projectsApi } from '../api';
import { TokenSavingsBar } from './TokenSavingsBar';
import { computeTokenSavings } from './tokenStats';
import { capaIdIssue, sanitizeCapaIdInput } from '../../../lib/ids';
import { refMatchesTool, skillRequiresTool, withSkillRequiresTool } from '../../../lib/toolRefs';
import { ReorderableList } from '../../../components/common/ReorderableList';

function capaIdErrorMessage(
  id: string,
  t: (key: string) => string,
): string | null {
  const issue = capaIdIssue(id);
  if (!issue) return null;
  if (issue === 'empty') return t('actions.idInvalidEmpty');
  if (issue === 'invalidStart') return t('actions.idInvalidStart');
  return t('actions.idInvalidChars');
}

interface ToolsSectionProps {
  projectId: string;
  skills: Skill[];
  tools: Tool[];
  servers: Server[];
  search: string;
  addServerOpen: boolean;
  addCommandToolOpen: boolean;
  onAddServerOpenChange: (open: boolean) => void;
  onAddCommandToolOpenChange: (open: boolean) => void;
  onEditServerOpenChange: (open: boolean) => void;
}

interface ToolLink {
  fromKey: string;
  toKey: string;
}

/** Stable DOM/link identity for a configured MCP tool (survives duplicate ids). */
function configuredToolAnchor(tool: {
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

function remoteToolAnchor(serverId: string, toolName: string): string {
  return `remote:${serverId}::${toolName}`;
}

function serverAnchor(serverId: string): string {
  return `server:${serverId}`;
}

function findAnchorEl(root: HTMLElement, key: string): HTMLElement | null {
  // Avoid CSS.escape/querySelector quirks with ':' — match attribute exactly.
  const nodes = root.querySelectorAll('[data-link-anchor]');
  for (const node of nodes) {
    if (node.getAttribute('data-link-anchor') === key && node instanceof HTMLElement) {
      return node;
    }
  }
  return null;
}

function filterLinksForFocus(
  links: ToolLink[],
  focusedAnchor: string | null,
  tools: Tool[],
): ToolLink[] {
  if (!focusedAnchor) return links;

  if (focusedAnchor.startsWith('cfg:')) {
    return links.filter((l) => l.toKey === focusedAnchor);
  }

  if (focusedAnchor.startsWith('remote:')) {
    // remote:${serverId}::${toolName}
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
    // Back-compat for any lingering callers
    const id = focusedAnchor.slice('tool:'.length);
    const match = tools.find((t) => t.id === id);
    if (!match) return [];
    const toKey = configuredToolAnchor(match);
    return links.filter((l) => l.toKey === toKey);
  }

  return [];
}

function suggestConfiguredToolId(
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

function toolMatchesSearch(tool: ToolSchema, query: string): boolean {
  const paramTexts = Object.entries(tool.inputSchema?.properties || {}).flatMap(
    ([name, s]) => [name, s.description || ''],
  );
  return matchesSearch([tool.name, tool.description, ...paramTexts], query);
}

export function ToolsSection({
  projectId,
  skills,
  tools,
  servers,
  search,
  addServerOpen,
  addCommandToolOpen,
  onAddServerOpenChange,
  onAddCommandToolOpenChange,
  onEditServerOpenChange,
}: ToolsSectionProps) {
  const { t } = useTranslation('projects');
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [focusedAnchor, setFocusedAnchor] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [editingCommandTool, setEditingCommandTool] = useState<Tool | null>(null);

  useEffect(() => {
    onEditServerOpenChange(!!editingServer);
  }, [editingServer, onEditServerOpenChange]);

  const selectAnchor = useCallback(
    (key: string) => {
      setFocusedAnchor((prev) => {
        const next = prev === key ? null : key;
        if (next) {
          let serverId: string | null = null;
          if (next.startsWith('remote:')) {
            const rest = next.slice('remote:'.length);
            serverId = rest.split('::')[0] || null;
          } else if (next.startsWith('cfg:')) {
            // cfg:${id}::${serverId}::${mcpTool}
            const rest = next.slice('cfg:'.length);
            const parts = rest.split('::');
            if (parts.length >= 3) serverId = parts[1] || null;
            else {
              const tool = tools.find((t) => configuredToolAnchor(t) === next);
              if (tool?.mcpServer) serverId = tool.mcpServer.replace(/^@/, '');
            }
          } else if (next.startsWith('tool:')) {
            const tool = tools.find((t) => t.id === next.slice('tool:'.length));
            if (tool?.mcpServer) serverId = tool.mcpServer.replace(/^@/, '');
          }
          if (serverId) {
            setExpandedServers((servers) => {
              if (servers.has(serverId!)) return servers;
              const copy = new Set(servers);
              copy.add(serverId!);
              return copy;
            });
          }
        }
        return next;
      });
    },
    [tools],
  );

  const toolRequiredByMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const skill of skills) {
      for (const ref of skill.requires || []) {
        const matched = tools.find((t) => refMatchesTool(ref, t));
        if (!matched) continue;
        if (!map[matched.id]) map[matched.id] = [];
        if (!map[matched.id].includes(skill.id)) map[matched.id].push(skill.id);
      }
    }
    return map;
  }, [skills, tools]);

  const configuredMcpKeys = useMemo(() => {
    const set = new Set<string>();
    for (const tool of tools) {
      if (tool.type === 'mcp' && tool.mcpServer && tool.mcpTool) {
        set.add(`${tool.mcpServer.replace(/^@/, '')}::${tool.mcpTool}`);
      }
    }
    return set;
  }, [tools]);

  const serverToolQueries = useQueries({
    queries: servers.map((server) => ({
      queryKey: ['server-tools', projectId, server.id] as const,
      queryFn: () => projectsApi.getServerTools(projectId, server.id),
      staleTime: 60_000,
      retry: false,
      enabled: !(server.requiresOAuth && !server.isConnected),
    })),
  });

  // Depend on settled data fingerprints, not the queries array identity (new every render)
  const serverToolsDataKey = serverToolQueries
    .map((q, i) => `${servers[i]?.id}:${q.dataUpdatedAt}:${q.data?.tools?.length ?? 0}`)
    .join('|');

  const serverToolsMap = useMemo(() => {
    const map: Record<string, ToolSchema[]> = {};
    servers.forEach((server, i) => {
      const query = serverToolQueries[i];
      if (query.data?.tools) map[server.id] = query.data.tools;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serverToolsDataKey
  }, [servers, serverToolsDataKey]);

  const serverToolSchemaCache = useMemo(() => {
    const cache: Record<string, Record<string, ToolSchema>> = {};
    for (const [serverId, list] of Object.entries(serverToolsMap)) {
      const map: Record<string, ToolSchema> = {};
      for (const tool of list) map[tool.name] = tool;
      cache[serverId] = map;
    }
    return cache;
  }, [serverToolsMap]);

  // Auto-expand servers whose tools (or the server itself) match the search
  useEffect(() => {
    if (!search.trim()) return;
    setExpandedServers((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const server of servers) {
        if (next.has(server.id)) continue;
        const cmdStr = server.cmd ? [server.cmd, ...(server.args || [])].join(' ') : '';
        const serverMatch = matchesSearch(
          [server.id, server.displayName, server.url, cmdStr, server.description],
          search,
        );
        const toolsMatch = (serverToolsMap[server.id] || []).some((tool) =>
          toolMatchesSearch(tool, search),
        );
        if (serverMatch || toolsMatch) {
          next.add(server.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [search, servers, serverToolsMap]);

  const toggleServer = useCallback((serverId: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }, []);

  const links = useMemo((): ToolLink[] => {
    const result: ToolLink[] = [];
    for (const tool of tools) {
      if (tool.type !== 'mcp' || !tool.mcpServer || !tool.mcpTool) continue;
      const serverId = tool.mcpServer.replace(/^@/, '');
      const fromKey = expandedServers.has(serverId)
        ? remoteToolAnchor(serverId, tool.mcpTool)
        : serverAnchor(serverId);
      result.push({ fromKey, toKey: configuredToolAnchor(tool) });
    }
    return result;
  }, [tools, expandedServers]);

  const visibleLinks = useMemo(
    () => filterLinksForFocus(links, focusedAnchor, tools),
    [links, focusedAnchor, tools],
  );

  const focusedRemoteAnchor = useMemo(() => {
    if (!focusedAnchor) return null;
    if (focusedAnchor.startsWith('remote:')) return focusedAnchor;
    if (focusedAnchor.startsWith('cfg:') || focusedAnchor.startsWith('tool:')) {
      const tool =
        tools.find((t) => configuredToolAnchor(t) === focusedAnchor) ||
        (focusedAnchor.startsWith('tool:')
          ? tools.find((t) => t.id === focusedAnchor.slice('tool:'.length))
          : undefined);
      if (tool?.type === 'mcp' && tool.mcpServer && tool.mcpTool) {
        return remoteToolAnchor(tool.mcpServer.replace(/^@/, ''), tool.mcpTool);
      }
    }
    return null;
  }, [focusedAnchor, tools]);

  const existingToolIds = useMemo(() => new Set(tools.map((t) => t.id)), [tools]);

  const tokenSavingsLoading =
    servers.length > 0 && serverToolQueries.some((q) => q.isLoading || q.isPending);
  const tokenSavings = useMemo(() => {
    if (servers.length === 0 || tokenSavingsLoading) return null;
    return computeTokenSavings(tools as EnrichedTool[], serverToolsMap, servers.length);
  }, [tools, servers, serverToolsMap, serverToolsDataKey, tokenSavingsLoading]);

  return (
    <div
      ref={containerRef}
      className="relative grid grid-cols-1 gap-4 lg:grid-cols-2"
      onClick={() => setFocusedAnchor(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setFocusedAnchor(null);
      }}
    >
      <div className="lg:col-span-2">
        <TokenSavingsBar stats={tokenSavings} loading={tokenSavingsLoading} />
      </div>
      <ToolLinkOverlay containerRef={containerRef} links={visibleLinks} />

      <div className="relative z-0 min-w-0 rounded-sm border border-border-tertiary bg-bg-primary/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            {t('detail.sections.servers')}
          </h3>
          <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
            {servers.length}
          </span>
        </div>
        <ServersPanel
          projectId={projectId}
          servers={servers}
          search={search}
          serverToolsMap={serverToolsMap}
          configuredMcpKeys={configuredMcpKeys}
          expandedServers={expandedServers}
          onToggleServer={toggleServer}
          focusedRemoteAnchor={focusedRemoteAnchor}
          onSelectAnchor={selectAnchor}
          onEditServer={setEditingServer}
          existingToolIds={existingToolIds}
        />
      </div>

      <div className="relative z-0 min-w-0 rounded-sm border border-border-tertiary bg-bg-primary/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            {t('detail.configuredTools')}
          </h3>
          <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
            {tools.length}
          </span>
        </div>
        <ConfiguredToolsPanel
          projectId={projectId}
          tools={tools as EnrichedTool[]}
          skills={skills}
          search={search}
          toolRequiredByMap={toolRequiredByMap}
          serverToolSchemaCache={serverToolSchemaCache}
          focusedAnchor={focusedAnchor}
          onSelectAnchor={selectAnchor}
          onEditCommandTool={setEditingCommandTool}
        />
      </div>

      <ServerDialog
        projectId={projectId}
        open={addServerOpen || !!editingServer}
        server={editingServer}
        onOpenChange={(open) => {
          if (!open) {
            onAddServerOpenChange(false);
            setEditingServer(null);
          }
        }}
      />

      <CommandToolDialog
        projectId={projectId}
        open={addCommandToolOpen || !!editingCommandTool}
        tool={editingCommandTool}
        onOpenChange={(open) => {
          if (!open) {
            onAddCommandToolOpenChange(false);
            setEditingCommandTool(null);
          }
        }}
      />
    </div>
  );
}

function ToolLinkOverlay({
  containerRef,
  links,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  links: ToolLink[];
}) {
  const [paths, setPaths] = useState<Array<{ d: string; key: string }>>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);
  const pathsKeyRef = useRef('');

  const redraw = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const nextW = root.clientWidth;
    const nextH = root.clientHeight;

    // Only draw on two-column layout
    if (rootRect.width < 1024) {
      if (pathsKeyRef.current !== '') {
        pathsKeyRef.current = '';
        setPaths([]);
      }
      return;
    }

    const next: Array<{ d: string; key: string }> = [];
    for (const link of links) {
      const fromEl = findAnchorEl(root, link.fromKey);
      const toEl = findAnchorEl(root, link.toKey);
      if (!fromEl || !toEl) continue;

      const from = fromEl.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();
      const x1 = from.right - rootRect.left;
      const x2 = to.left - rootRect.left;
      const rawY1 = from.top + from.height / 2 - rootRect.top;
      const rawY2 = to.top + to.height / 2 - rootRect.top;

      const fromClip = clipYToPanel(fromEl, rawY1, rootRect);
      const toClip = clipYToPanel(toEl, rawY2, rootRect);
      // Both ends scrolled out of their panels — nothing useful to draw
      if (!fromClip.inView && !toClip.inView) continue;

      const y1 = fromClip.y;
      const y2 = toClip.y;
      const dx = Math.max(40, (x2 - x1) * 0.45);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      next.push({ d, key: `${link.fromKey}->${link.toKey}` });
    }

    const key = next.map((p) => p.d).join('|');
    if (key !== pathsKeyRef.current) {
      pathsKeyRef.current = key;
      setPaths(next);
    }
    setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
  }, [containerRef, links]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      redraw();
    });
  }, [redraw]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const observed = new Set<Element>();
    const ro = new ResizeObserver(() => scheduleRedraw());

    const observeEl = (el: Element) => {
      if (observed.has(el)) return;
      observed.add(el);
      ro.observe(el);
    };

    const syncObservers = () => {
      observeEl(root);
      root.querySelectorAll('[data-tools-panel-content]').forEach(observeEl);
      root.querySelectorAll('[data-link-anchor]').forEach(observeEl);
    };

    syncObservers();
    const mo = new MutationObserver(() => {
      syncObservers();
      scheduleRedraw();
    });
    mo.observe(root, { childList: true, subtree: true });

    window.addEventListener('scroll', scheduleRedraw, true);
    return () => {
      mo.disconnect();
      ro.disconnect();
      observed.clear();
      window.removeEventListener('scroll', scheduleRedraw, true);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, scheduleRedraw]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 hidden overflow-hidden lg:block text-accent-primary"
      width={size.w}
      height={size.h}
      aria-hidden
    >
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-80"
        />
      ))}
    </svg>
  );
}

/** Clamp a link endpoint Y to its scroll panel's visible bounds (root-local coords). */
function clipYToPanel(
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

function ServersPanel({
  projectId,
  servers,
  search,
  serverToolsMap,
  configuredMcpKeys,
  expandedServers,
  onToggleServer,
  focusedRemoteAnchor,
  onSelectAnchor,
  onEditServer,
  existingToolIds,
}: {
  projectId: string;
  servers: Server[];
  search: string;
  serverToolsMap: Record<string, ToolSchema[]>;
  configuredMcpKeys: Set<string>;
  expandedServers: Set<string>;
  onToggleServer: (id: string) => void;
  focusedRemoteAnchor: string | null;
  onSelectAnchor: (key: string) => void;
  onEditServer: (server: Server) => void;
  existingToolIds: Set<string>;
}) {
  const { t } = useTranslation('projects');
  const reorderMutation = useReorderCapability(projectId);
  const searching = !!search.trim();
  const visible = servers.filter((server) => {
    const cmdStr = server.cmd ? [server.cmd, ...(server.args || [])].join(' ') : '';
    if (
      matchesSearch(
        [server.id, server.displayName, server.url, cmdStr, server.description],
        search,
      )
    ) {
      return true;
    }
    if (search) {
      return (serverToolsMap[server.id] || []).some((tool) => toolMatchesSearch(tool, search));
    }
    return false;
  });

  if (visible.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-text-tertiary">
        {search ? t('detail.noServersMatch') : t('actions.emptyServers')}
      </div>
    );
  }

  return (
    <div
      data-tools-panel-scroll
      className="max-h-[520px] overflow-y-auto pr-1"
    >
      <div data-tools-panel-content>
        <ReorderableList
          items={visible}
          getId={(s) => s.id}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'servers', ids })}
          renderItem={(server, { handle }) => (
            <ServerCard
              projectId={projectId}
              server={server}
              search={search}
              tools={serverToolsMap[server.id]}
              configuredMcpKeys={configuredMcpKeys}
              expanded={expandedServers.has(server.id)}
              onToggle={() => onToggleServer(server.id)}
              focusedRemoteAnchor={focusedRemoteAnchor}
              onSelectAnchor={onSelectAnchor}
              onEdit={() => onEditServer(server)}
              existingToolIds={existingToolIds}
              dragHandle={handle}
            />
          )}
        />
      </div>
    </div>
  );
}

function ServerCard({
  projectId,
  server,
  search,
  tools,
  configuredMcpKeys,
  expanded,
  onToggle,
  focusedRemoteAnchor,
  onSelectAnchor,
  onEdit,
  existingToolIds,
  dragHandle,
}: {
  projectId: string;
  server: Server;
  search: string;
  tools?: ToolSchema[];
  configuredMcpKeys: Set<string>;
  expanded: boolean;
  onToggle: () => void;
  focusedRemoteAnchor: string | null;
  onSelectAnchor: (key: string) => void;
  onEdit: () => void;
  existingToolIds: Set<string>;
  dragHandle?: ReactNode;
}) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const appendMutation = useAppendCapability(projectId);
  const startOAuth = useStartOAuth(projectId);
  const disconnectOAuth = useDisconnectOAuth(projectId);
  const locked = !!server.sourcePlugin;
  const label = server.displayName || server.id;

  const visibleTools = useMemo(() => {
    if (!tools) return undefined;
    if (!search.trim()) return tools;
    const filtered = tools.filter((tool) => toolMatchesSearch(tool, search));
    // If the server itself matched but no tools did, still show all tools when expanded
    if (filtered.length === 0) {
      const cmdStr = server.cmd ? [server.cmd, ...(server.args || [])].join(' ') : '';
      if (
        matchesSearch(
          [server.id, server.displayName, server.url, cmdStr, server.description],
          search,
        )
      ) {
        return tools;
      }
    }
    return filtered;
  }, [tools, search, server]);

  async function handleConnect() {
    try {
      const res = await startOAuth.mutateAsync(server.id);
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch {
      // surfaced via mutation
    }
  }

  async function handleUseTool(tool: ToolSchema) {
    const toolId = suggestConfiguredToolId(server.id, tool.name, existingToolIds);
    await appendMutation.mutateAsync({
      section: 'tools',
      entry: {
        id: toolId,
        type: 'mcp',
        description: tool.description || undefined,
        def: {
          server: `@${server.id}`,
          tool: tool.name,
        },
      },
    });
  }

  return (
    <div
      className="rounded-sm border border-border-tertiary bg-bg-tertiary"
      data-link-anchor={serverAnchor(server.id)}
    >
      <div className="flex items-start gap-1 p-2">
        {dragHandle}
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer"
        >
          <ChevronRight
            size={14}
            className="ui-chevron"
            data-open={expanded ? 'true' : 'false'}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-xs font-medium text-text-primary"
              dangerouslySetInnerHTML={{ __html: highlightText(label, search) }}
            />
            {server.requiresOAuth && (
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[10px] ${
                  server.isConnected
                    ? 'bg-success-bg text-success-text'
                    : 'bg-[hsl(40_80%_50%/0.15)] text-[hsl(40_80%_45%)]'
                }`}
              >
                {server.isConnected ? t('actions.connected') : t('actions.needsOAuth')}
              </span>
            )}
          </div>
          {(server.url || server.cmd) && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
              {server.url || [server.cmd, ...(server.args || [])].join(' ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {server.requiresOAuth && !server.isConnected && (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={startOAuth.isPending}
              className="inline-flex items-center gap-1 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
            >
              <Link2 size={12} />
              {t('actions.connect')}
            </button>
          )}
          {server.requiresOAuth && server.isConnected && (
            <button
              type="button"
              onClick={() => {
                if (confirm(t('oauth.confirmDisconnect', { name: label }))) {
                  disconnectOAuth.mutate(server.id);
                }
              }}
              className="inline-flex items-center gap-1 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg"
            >
              <Unlink size={12} />
              {t('actions.disconnect')}
            </button>
          )}
          {locked ? (
            <span title={t('actions.pluginLocked')} className="p-1.5 text-text-tertiary">
              <Lock size={14} />
            </span>
          ) : (
            <>
              <button
                type="button"
                title={t('actions.editServer')}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                title={t('actions.delete')}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  const cascade = confirm(t('actions.confirmDeleteServer', { id: server.id }));
                  if (!cascade) return;
                  const alsoTools = confirm(t('actions.cascadeTools'));
                  deleteMutation.mutate({
                    section: 'servers',
                    entryId: server.id,
                    cascadeTools: alsoTools,
                  });
                }}
                className="rounded-sm p-1.5 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-secondary px-2 pb-2 pt-2">
          {server.requiresOAuth && !server.isConnected ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <p className="text-[11px] text-text-tertiary">{t('tool.connectFirst')}</p>
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={startOAuth.isPending}
                className="inline-flex items-center gap-1 rounded-sm border border-border-tertiary px-2.5 py-1 text-[11px] text-text-secondary cursor-pointer hover:bg-hover-bg disabled:opacity-50"
              >
                <Link2 size={12} />
                {t('actions.connect')}
              </button>
            </div>
          ) : !visibleTools ? (
            <Spinner className="py-3" />
          ) : visibleTools.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-text-tertiary">
              {search ? t('detail.noToolsMatch') : t('tool.noToolsOnServer')}
            </p>
          ) : (
            <div className="space-y-1">
              {visibleTools.map((tool) => {
                const key = `${server.id}::${tool.name}`;
                const inUse = configuredMcpKeys.has(key);
                const anchor = remoteToolAnchor(server.id, tool.name);
                const focused = focusedRemoteAnchor === anchor;
                return (
                  <div
                    key={`${server.id}::${tool.name}`}
                    data-link-anchor={anchor}
                    role="button"
                    tabIndex={0}
                    aria-pressed={focused}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAnchor(anchor);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAnchor(anchor);
                      }
                    }}
                    className={`flex items-start gap-2 rounded-sm border bg-bg-secondary px-2 py-1.5 outline-none transition-colors cursor-pointer hover:border-border-primary ${
                      focused
                        ? 'border-accent-primary ring-1 ring-accent-primary'
                        : 'border-border-secondary'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-mono text-[11px] font-medium text-text-primary"
                        dangerouslySetInnerHTML={{ __html: highlightText(tool.name, search) }}
                      />
                      {tool.description && (
                        <div
                          className="mt-0.5 line-clamp-2 text-[10px] text-text-secondary"
                          dangerouslySetInnerHTML={{
                            __html: highlightText(tool.description, search),
                          }}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={inUse || appendMutation.isPending}
                      title={inUse ? t('actions.toolInUse') : t('actions.useTool')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUseTool(tool);
                      }}
                      className={`shrink-0 rounded-sm p-1.5 cursor-pointer disabled:cursor-default ${
                        inUse
                          ? 'text-success-text'
                          : 'text-text-tertiary hover:bg-hover-bg hover:text-text-primary'
                      }`}
                    >
                      {inUse ? <Check size={14} /> : <Plus size={14} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfiguredToolsPanel({
  projectId,
  tools,
  skills,
  search,
  toolRequiredByMap,
  serverToolSchemaCache,
  focusedAnchor,
  onSelectAnchor,
  onEditCommandTool,
}: {
  projectId: string;
  tools: EnrichedTool[];
  skills: Skill[];
  search: string;
  toolRequiredByMap: Record<string, string[]>;
  serverToolSchemaCache: Record<string, Record<string, ToolSchema>>;
  focusedAnchor: string | null;
  onSelectAnchor: (key: string) => void;
  onEditCommandTool: (tool: Tool) => void;
}) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const searching = !!search.trim();

  const enriched = tools.map((tool) => {
    if (tool.type !== 'mcp' || !tool.mcpServer || !tool.mcpTool) return tool;
    const serverId = tool.mcpServer.replace(/^@/, '');
    const schema = serverToolSchemaCache[serverId]?.[tool.mcpTool];
    if (!schema) return tool;
    return {
      ...tool,
      _description: schema.description || '',
      _inputSchema: schema.inputSchema || {},
    };
  });

  const visible = enriched.filter((tool) => {
    const paramTexts = Object.entries(tool._inputSchema?.properties || {}).flatMap(
      ([name, s]) => [name, s.description || ''],
    );
    const requiredBy = toolRequiredByMap[tool.id] || [];
    return matchesSearch(
      [
        tool.id,
        tool.description,
        tool._description,
        tool.mcpTool,
        tool.mcpServer,
        tool.command,
        ...paramTexts,
        ...requiredBy,
      ],
      search,
    );
  });

  if (visible.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-text-tertiary">
        {search ? t('detail.noToolsMatch') : t('actions.emptyTools')}
      </div>
    );
  }

  return (
    <div
      data-tools-panel-scroll
      className="max-h-[520px] overflow-y-auto pr-1"
    >
      <div data-tools-panel-content>
        <ReorderableList
          items={visible}
          getId={(tool) => tool.id}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'tools', ids })}
          renderItem={(tool, { handle }) => (
            <ConfiguredToolCard
              projectId={projectId}
              tool={tool}
              skills={skills}
              search={search}
              requiredBy={toolRequiredByMap[tool.id] || []}
              focused={isToolFocused(tool, focusedAnchor)}
              onSelect={() => onSelectAnchor(configuredToolAnchor(tool))}
              onEditCommand={
                tool.type === 'command' ? () => onEditCommandTool(tool) : undefined
              }
              onDelete={() => {
                if (confirm(t('actions.confirmDeleteTool', { id: tool.id }))) {
                  deleteMutation.mutate({ section: 'tools', entryId: tool.id });
                }
              }}
              deleting={deleteMutation.isPending}
              dragHandle={handle}
            />
          )}
        />
      </div>
    </div>
  );
}

function isToolFocused(tool: Tool, focusedAnchor: string | null): boolean {
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

function ConfiguredToolCard({
  projectId,
  tool,
  skills,
  search,
  requiredBy,
  focused,
  onSelect,
  onEditCommand,
  onDelete,
  deleting,
  dragHandle,
}: {
  projectId: string;
  tool: EnrichedTool;
  skills: Skill[];
  search: string;
  requiredBy: string[];
  focused: boolean;
  onSelect: () => void;
  onEditCommand?: () => void;
  onDelete: () => void;
  deleting: boolean;
  dragHandle?: ReactNode;
}) {
  const { t } = useTranslation('projects');
  const updateMutation = useUpdateCapability(projectId);
  const updateSkillMutation = useUpdateCapability(projectId);
  const [editingId, setEditingId] = useState(false);
  const [draftId, setDraftId] = useState(tool.id);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [formatterOpen, setFormatterOpen] = useState(!!tool.formatter);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const desc = tool.description || tool._description || '';

  async function saveRename() {
    const next = draftId.replace(/[^a-zA-Z0-9_-]/g, '');
    const idErr = capaIdErrorMessage(next, t);
    if (idErr || !next || next === tool.id) {
      setEditingId(false);
      setDraftId(tool.id);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        section: 'tools',
        entryId: tool.id,
        patch: { id: next },
      });
      setEditingId(false);
    } catch {
      // keep editing so user can fix
    }
  }

  return (
    <div
      data-link-anchor={configuredToolAnchor(tool)}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`rounded-sm border bg-bg-tertiary p-2.5 outline-none transition-colors cursor-pointer ${
        focused
          ? 'border-accent-primary ring-1 ring-accent-primary'
          : 'border-border-tertiary hover:border-border-primary'
      }`}
    >
      <div className="flex items-start gap-2">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editingId ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRename();
                }}
              >
                <input
                  autoFocus
                  value={draftId}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setDraftId(sanitizeCapaIdInput(e.target.value))}
                  onBlur={() => void saveRename()}
                  className="min-w-0 flex-1 rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-0.5 font-mono text-xs text-text-primary"
                />
              </form>
            ) : (
              <>
                <span
                  className="truncate font-mono text-xs font-medium text-text-primary"
                  dangerouslySetInnerHTML={{ __html: highlightText(tool.id, search) }}
                />
                <button
                  type="button"
                  title={t('actions.renameTool')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraftId(tool.id);
                    setEditingId(true);
                  }}
                  className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
            <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary">
              {tool.type}
            </span>
          </div>
          {desc && (
            <p
              className="mt-1 text-[11px] text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(desc, search) }}
            />
          )}
          {tool.type === 'mcp' && tool.mcpServer && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-text-tertiary">
              <SourceBadge name={tool.mcpServer.replace(/^@/, '')} kind="server" search={search} />
              <span>→</span>
              <span
                className="font-mono"
                dangerouslySetInnerHTML={{
                  __html: highlightText(tool.mcpTool || '', search),
                }}
              />
            </div>
          )}
          {tool.type === 'command' && tool.command && (
            <p
              className="mt-1 truncate font-mono text-[11px] text-text-tertiary"
              dangerouslySetInnerHTML={{ __html: highlightText(tool.command, search) }}
            />
          )}
          {tool.type === 'command' && tool.group && (
            <p className="mt-0.5 text-[10px] text-text-tertiary">
              group: <span className="font-mono">{tool.group}</span>
            </p>
          )}
        </div>
        {onEditCommand && (
          <button
            type="button"
            title={t('actions.editCommandTool')}
            onClick={(e) => {
              e.stopPropagation();
              onEditCommand();
            }}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
          >
            <Pencil size={14} />
          </button>
        )}
        <button
          type="button"
          title={t('actions.delete')}
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-sm p-1.5 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {tool.type === 'mcp' &&
        tool._inputSchema?.properties &&
        Object.keys(tool._inputSchema.properties).length > 0 && (
          <div className="mt-2 border-t border-border-secondary pt-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDefaultsOpen((v) => !v);
              }}
              className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary"
            >
              <ChevronRight
                size={12}
                className="ui-chevron"
                data-open={defaultsOpen ? 'true' : 'false'}
              />
              {t('actions.defaults')}
              <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
                {Object.keys(tool._inputSchema.properties).length}
              </span>
            </button>
            {defaultsOpen && (
              <div className="ui-panel-enter">
              <DefaultsEditor
                tool={tool}
                busy={updateMutation.isPending}
                onSave={(defaults) =>
                  updateMutation.mutate({
                    section: 'tools',
                    entryId: tool.id,
                    patch: {
                      def: {
                        server: tool.mcpServer,
                        tool: tool.mcpTool,
                        defaults,
                        ...(tool.formatter ? { formatter: tool.formatter } : {}),
                      },
                    },
                  })
                }
              />
              </div>
            )}
          </div>
        )}

      {tool.type === 'mcp' && (
        <div className="mt-1 border-t border-border-secondary pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFormatterOpen((v) => !v);
            }}
            className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary"
          >
            <ChevronRight
              size={12}
              className="ui-chevron"
              data-open={formatterOpen ? 'true' : 'false'}
            />
            {t('actions.formatter')}
            <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
              {tool.formatter?.cmd ? 1 : 0}
            </span>
          </button>
          {formatterOpen && (
            <div className="ui-panel-enter">
            <FormatterEditor
              tool={tool}
              busy={updateMutation.isPending}
              onSave={(formatter) =>
                updateMutation.mutate({
                  section: 'tools',
                  entryId: tool.id,
                  patch: {
                    def: {
                      server: tool.mcpServer,
                      tool: tool.mcpTool,
                      ...(tool.defaults ? { defaults: tool.defaults } : {}),
                      formatter,
                    },
                  },
                })
              }
            />
            </div>
          )}
        </div>
      )}

      <div className="mt-1 border-t border-border-secondary pt-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSkillsOpen((v) => !v);
          }}
          className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary"
        >
          <ChevronRight
            size={12}
            className="ui-chevron"
            data-open={skillsOpen ? 'true' : 'false'}
          />
          {t('actions.associatedSkills')}
          <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
            {requiredBy.length}
          </span>
        </button>
        {skillsOpen && (
          <div className="ui-panel-enter pb-1">
            <div className="mt-1 flex flex-wrap gap-1">
              {skills.map((skill) => {
                const checked = skillRequiresTool(skill.requires, tool);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    disabled={!!skill.sourcePlugin || updateSkillMutation.isPending}
                    onClick={() => {
                      const next = withSkillRequiresTool(skill.requires, tool, !checked);
                      updateSkillMutation.mutate({
                        section: 'skills',
                        entryId: skill.id,
                        patch: { def: { requires: next } },
                      });
                    }}
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] cursor-pointer disabled:opacity-40 ${
                      checked
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-secondary text-text-tertiary hover:bg-hover-bg'
                    }`}
                  >
                    {skill.id}
                  </button>
                );
              })}
              {skills.length === 0 && (
                <span className="text-[10px] text-text-tertiary">{t('actions.emptySkills')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DefaultsEditor({
  tool,
  busy,
  onSave,
}: {
  tool: EnrichedTool;
  busy: boolean;
  onSave: (defaults: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation('projects');
  const props = tool._inputSchema?.properties || {};
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [key, value] of Object.entries(tool.defaults || {})) {
      init[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return init;
  });

  const entries = Object.keys(props);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1 pb-1" onClick={(e) => e.stopPropagation()}>
      {entries.map((name) => (
        <label key={name} className="flex items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0 truncate font-mono text-text-secondary" title={name}>
            {name}
          </span>
          <input
            value={draft[name] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
            className="min-w-0 flex-1 rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary"
          />
        </label>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const defaults: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(draft)) {
            if (v.trim() === '') continue;
            try {
              defaults[k] = JSON.parse(v);
            } catch {
              defaults[k] = v;
            }
          }
          onSave(defaults);
        }}
        className="mt-1 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
      >
        {t('actions.saveDefaults')}
      </button>
    </div>
  );
}

function FormatterEditor({
  tool,
  busy,
  onSave,
}: {
  tool: EnrichedTool;
  busy: boolean;
  onSave: (formatter: { cmd: string; timeout?: number } | null) => void;
}) {
  const { t } = useTranslation('projects');
  const [cmd, setCmd] = useState(tool.formatter?.cmd || '');
  const [timeoutMs, setTimeoutMs] = useState(
    tool.formatter?.timeout != null ? String(tool.formatter.timeout) : '',
  );

  useEffect(() => {
    setCmd(tool.formatter?.cmd || '');
    setTimeoutMs(tool.formatter?.timeout != null ? String(tool.formatter.timeout) : '');
  }, [tool.id, tool.formatter?.cmd, tool.formatter?.timeout]);

  return (
    <div className="space-y-2 pb-1" onClick={(e) => e.stopPropagation()}>
      <label className="block text-[11px] text-text-secondary">
        {t('actions.formatterCmd')}
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="jq -r '.[] | [.id, .name] | @tsv'"
          className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary"
        />
        <span className="mt-0.5 block text-[10px] text-text-tertiary">{t('actions.formatterCmdHint')}</span>
      </label>
      <label className="block text-[11px] text-text-secondary">
        {t('actions.formatterTimeout')}
        <input
          type="number"
          min={1}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          placeholder="3000"
          className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary"
        />
        <span className="mt-0.5 block text-[10px] text-text-tertiary">
          {t('actions.formatterTimeoutHint')}
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !cmd.trim()}
          onClick={() => {
            const parsed = timeoutMs.trim() ? Number(timeoutMs) : undefined;
            onSave({
              cmd: cmd.trim(),
              ...(parsed != null && Number.isFinite(parsed) && parsed > 0
                ? { timeout: Math.floor(parsed) }
                : {}),
            });
          }}
          className="rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
        >
          {t('actions.saveFormatter')}
        </button>
        {tool.formatter && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCmd('');
              setTimeoutMs('');
              onSave(null);
            }}
            className="rounded-sm px-2 py-1 text-[11px] text-text-tertiary hover:bg-hover-bg hover:text-text-secondary cursor-pointer disabled:opacity-50"
          >
            {t('actions.clearFormatter')}
          </button>
        )}
      </div>
    </div>
  );
}

function pairsToRecord(pairs: Array<{ key: string; value: string }>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (!k) continue;
    out[k] = p.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function KeyValueEditor({
  pairs,
  onChange,
  keyLabel,
  valueLabel,
  addLabel,
}: {
  pairs: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={pair.key}
            placeholder={keyLabel}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = { ...pair, key: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-1 rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
          />
          <input
            value={pair.value}
            placeholder={valueLabel}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = { ...pair, value: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-[1.4] rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
          />
          <button
            type="button"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
      >
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}

function recordToPairs(
  record: Record<string, string> | null | undefined,
): Array<{ key: string; value: string }> {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function serverHasAdvanced(server: Server): boolean {
  return !!(
    server.displayName ||
    server.description ||
    (server.headers && Object.keys(server.headers).length > 0) ||
    (server.env && Object.keys(server.env).length > 0) ||
    server.cwd ||
    server.tlsSkipVerify ||
    server.oauth2
  );
}

function ServerDialog({
  projectId,
  open,
  onOpenChange,
  server,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server | null;
}) {
  const { t } = useTranslation('projects');
  const isEdit = !!server;
  const [mode, setMode] = useState<'http' | 'stdio'>('http');
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [cwd, setCwd] = useState('');
  const [tlsSkipVerify, setTlsSkipVerify] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthAuthUrl, setOauthAuthUrl] = useState('');
  const [oauthTokenUrl, setOauthTokenUrl] = useState('');
  const [oauthScopes, setOauthScopes] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');
  const [oauthPkce, setOauthPkce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appendMutation = useAppendCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const busy = appendMutation.isPending || updateMutation.isPending;

  function resetForm() {
    setMode('http');
    setId('');
    setUrl('');
    setCmd('');
    setArgs('');
    setDisplayName('');
    setDescription('');
    setHeaders([]);
    setEnv([]);
    setCwd('');
    setTlsSkipVerify(false);
    setAdvancedOpen(false);
    setOauthClientId('');
    setOauthClientSecret('');
    setOauthAuthUrl('');
    setOauthTokenUrl('');
    setOauthScopes('');
    setOauthRedirectUri('');
    setOauthPkce(false);
    setError(null);
  }

  function loadServer(s: Server) {
    const isHttp = !!s.url;
    setMode(isHttp ? 'http' : 'stdio');
    setId(s.id);
    setUrl(s.url || '');
    setCmd(s.cmd || '');
    setArgs((s.args || []).join(' '));
    setDisplayName(s.displayName || '');
    setDescription(s.description || '');
    setHeaders(recordToPairs(s.headers));
    setEnv(recordToPairs(s.env));
    setCwd(s.cwd || '');
    setTlsSkipVerify(!!s.tlsSkipVerify);
    setOauthClientId(s.oauth2?.clientId || '');
    setOauthClientSecret(s.oauth2?.clientSecret || '');
    setOauthAuthUrl(s.oauth2?.authorizationUrl || '');
    setOauthTokenUrl(s.oauth2?.tokenUrl || '');
    setOauthScopes((s.oauth2?.scopes || []).join(' '));
    setOauthRedirectUri(s.oauth2?.redirectUri || '');
    setOauthPkce(!!s.oauth2?.pkce);
    setAdvancedOpen(serverHasAdvanced(s));
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    if (server) loadServer(server);
    else resetForm();
    // Only re-hydrate when the dialog opens or the edited server identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server?.id]);

  function buildEntry(): Record<string, unknown> | null {
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return null;
    }
    const def: Record<string, unknown> =
      mode === 'http'
        ? { url: url.trim() }
        : {
            cmd: cmd.trim(),
            args: args
              .split(/\s+/)
              .map((a) => a.trim())
              .filter(Boolean),
          };

    if (mode === 'http') {
      const headerMap = pairsToRecord(headers);
      if (headerMap) def.headers = headerMap;
      if (tlsSkipVerify) def.tlsSkipVerify = true;

      const scopes = oauthScopes
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const oauth2: Record<string, unknown> = {};
      if (oauthClientId.trim()) oauth2.clientId = oauthClientId.trim();
      if (oauthClientSecret.trim()) oauth2.clientSecret = oauthClientSecret.trim();
      if (oauthAuthUrl.trim()) oauth2.authorizationUrl = oauthAuthUrl.trim();
      if (oauthTokenUrl.trim()) oauth2.tokenUrl = oauthTokenUrl.trim();
      if (scopes.length) oauth2.scopes = scopes;
      if (oauthRedirectUri.trim()) oauth2.redirectUri = oauthRedirectUri.trim();
      if (oauthPkce) oauth2.pkce = true;
      if (Object.keys(oauth2).length > 0) def.oauth2 = oauth2;
    } else {
      const envMap = pairsToRecord(env);
      if (envMap) def.env = envMap;
      if (cwd.trim()) def.cwd = cwd.trim();
    }

    const entry: Record<string, unknown> = {
      id: id.trim(),
      type: 'mcp',
      def,
      displayName: displayName.trim() || null,
      description: description.trim() || null,
    };
    return entry;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const entry = buildEntry();
    if (!entry) return;
    try {
      if (isEdit && server) {
        await updateMutation.mutateAsync({
          section: 'servers',
          entryId: server.id,
          patch: entry,
        });
      } else {
        await appendMutation.mutateAsync({ section: 'servers', entry });
      }
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[min(90vh,720px)] w-[min(560px,92vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editServer') : t('actions.addServer')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mb-3 flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setMode('http')}
              className={`rounded-sm px-3 py-1.5 text-xs cursor-pointer ${
                mode === 'http' ? 'bg-accent-primary/15 text-accent-primary' : 'bg-bg-tertiary text-text-secondary'
              }`}
            >
              HTTP
            </button>
            <button
              type="button"
              onClick={() => setMode('stdio')}
              className={`rounded-sm px-3 py-1.5 text-xs cursor-pointer ${
                mode === 'stdio' ? 'bg-accent-primary/15 text-accent-primary' : 'bg-bg-tertiary text-text-secondary'
              }`}
            >
              stdio
            </button>
          </div>

          {error && <p className="mb-3 shrink-0 text-xs text-error-text">{error}</p>}

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <label className="block text-xs text-text-secondary">
                {t('actions.serverId')}
                <input
                  value={id}
                  onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
              </label>
              {mode === 'http' ? (
                <label className="block text-xs text-text-secondary">
                  URL
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://… or ${API_URL}"
                    className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                  />
                </label>
              ) : (
                <>
                  <label className="block text-xs text-text-secondary">
                    Command
                    <input
                      value={cmd}
                      onChange={(e) => setCmd(e.target.value)}
                      className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                    />
                  </label>
                  <label className="block text-xs text-text-secondary">
                    Args
                    <input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="arg1 arg2"
                      className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                    />
                  </label>
                </>
              )}

              <div className="rounded-sm border border-border-tertiary">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs font-medium text-text-secondary hover:bg-hover-bg cursor-pointer"
                >
                  <ChevronRight
                    size={14}
                    className="ui-chevron"
                    data-open={advancedOpen ? 'true' : 'false'}
                  />
                  {t('actions.serverAdvanced')}
                </button>
                {advancedOpen && (
                  <div className="ui-panel-enter space-y-3 border-t border-border-tertiary px-2.5 py-3">
                    <label className="block text-xs text-text-secondary">
                      {t('actions.serverDisplayName')}
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                      />
                    </label>
                    <label className="block text-xs text-text-secondary">
                      {t('actions.serverDescription')}
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        className="mt-1 w-full resize-y rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                      />
                    </label>

                    {mode === 'http' ? (
                      <>
                        <div>
                          <div className="mb-1.5 text-xs text-text-secondary">{t('actions.serverHeaders')}</div>
                          <KeyValueEditor
                            pairs={headers}
                            onChange={setHeaders}
                            keyLabel={t('actions.serverKvKey')}
                            valueLabel={t('actions.serverKvValue')}
                            addLabel={t('actions.serverAddPair')}
                          />
                        </div>
                        <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tlsSkipVerify}
                            onChange={(e) => setTlsSkipVerify(e.target.checked)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="text-text-primary">{t('actions.serverTlsSkipVerify')}</span>
                            <span className="mt-0.5 block text-[11px] text-text-tertiary">
                              {t('actions.serverTlsSkipVerifyHint')}
                            </span>
                          </span>
                        </label>

                        <div className="space-y-2 border-t border-border-secondary pt-3">
                          <div className="text-xs font-medium text-text-secondary">{t('actions.serverOauth')}</div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthClientId')}
                              <input
                                value={oauthClientId}
                                onChange={(e) => setOauthClientId(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthClientSecret')}
                              <input
                                type="password"
                                value={oauthClientSecret}
                                onChange={(e) => setOauthClientSecret(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary sm:col-span-2">
                              {t('actions.serverOauthAuthUrl')}
                              <input
                                value={oauthAuthUrl}
                                onChange={(e) => setOauthAuthUrl(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary sm:col-span-2">
                              {t('actions.serverOauthTokenUrl')}
                              <input
                                value={oauthTokenUrl}
                                onChange={(e) => setOauthTokenUrl(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthScopes')}
                              <input
                                value={oauthScopes}
                                onChange={(e) => setOauthScopes(e.target.value)}
                                placeholder={t('actions.serverOauthScopesHint')}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthRedirectUri')}
                              <input
                                value={oauthRedirectUri}
                                onChange={(e) => setOauthRedirectUri(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                            <input
                              type="checkbox"
                              checked={oauthPkce}
                              onChange={(e) => setOauthPkce(e.target.checked)}
                            />
                            {t('actions.serverOauthPkce')}
                          </label>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <div className="mb-1.5 text-xs text-text-secondary">{t('actions.serverEnv')}</div>
                          <KeyValueEditor
                            pairs={env}
                            onChange={setEnv}
                            keyLabel={t('actions.serverKvKey')}
                            valueLabel={t('actions.serverKvValue')}
                            addLabel={t('actions.serverAddPair')}
                          />
                        </div>
                        <label className="block text-xs text-text-secondary">
                          {t('actions.serverCwd')}
                          <input
                            value={cwd}
                            onChange={(e) => setCwd(e.target.value)}
                            placeholder="/path/to/workdir"
                            className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 shrink-0 border-t border-border-secondary pt-3">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? t('actions.saveServer') : t('actions.add')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type CommandArgDraft = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
};

function CommandToolDialog({
  projectId,
  open,
  tool,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  tool: Tool | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('projects');
  const appendMutation = useAppendCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const isEdit = !!tool;
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [group, setGroup] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState<CommandArgDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setId('');
    setDescription('');
    setGroup('');
    setCmd('');
    setArgs([]);
    setError(null);
  }

  function hydrateFromTool(source: Tool) {
    setId(source.id);
    setDescription(source.description || '');
    setGroup(source.group || '');
    setCmd(source.command || '');
    setArgs(
      (source.commandArgs || []).map((a) => ({
        name: a.name,
        type: (['string', 'number', 'boolean', 'object', 'array'].includes(a.type || '')
          ? a.type
          : 'string') as CommandArgDraft['type'],
        description: a.description || '',
        required: !!a.required,
      })),
    );
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    if (tool) hydrateFromTool(tool);
    else resetForm();
  }, [open, tool]);

  function updateArg(index: number, patch: Partial<CommandArgDraft>) {
    setArgs((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    if (!cmd.trim()) {
      setError(t('actions.commandToolRequired'));
      return;
    }
    for (const arg of args) {
      const argErr = capaIdErrorMessage(arg.name, t);
      if (argErr) {
        setError(`${t('actions.commandArgName')}: ${argErr}`);
        return;
      }
    }
    const entry: Record<string, unknown> = {
      id: id.trim(),
      type: 'command',
      description: description.trim() || null,
      group: group.trim() || null,
      def: {
        run: {
          cmd: cmd.trim(),
          args: args.map((a) => ({
            name: a.name.trim(),
            type: a.type,
            ...(a.description.trim() ? { description: a.description.trim() } : {}),
            ...(a.required ? { required: true } : {}),
          })),
        },
      },
    };
    try {
      if (isEdit && tool) {
        await updateMutation.mutateAsync({
          section: 'tools',
          entryId: tool.id,
          patch: entry,
        });
      } else {
        await appendMutation.mutateAsync({ section: 'tools', entry });
      }
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pending = appendMutation.isPending || updateMutation.isPending;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[min(90vh,720px)] w-[min(560px,92vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editCommandTool') : t('actions.addCommandTool')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {error && <p className="mb-3 shrink-0 text-xs text-error-text">{error}</p>}
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <label className="block text-xs text-text-secondary">
                ID
                <input
                  value={id}
                  onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                {t('actions.description')}
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                {t('actions.commandToolGroup')}
                <input
                  value={group}
                  onChange={(e) => setGroup(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
                <span className="mt-0.5 block text-[10px] text-text-tertiary">
                  {t('actions.commandToolGroupHint')}
                </span>
              </label>
              <label className="block text-xs text-text-secondary">
                {t('actions.commandToolCmd')}
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  placeholder='echo Hello, {name}!'
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
                <span className="mt-0.5 block text-[10px] text-text-tertiary">
                  {t('actions.commandToolCmdHint')}
                </span>
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{t('actions.commandToolArgs')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setArgs((prev) => [
                        ...prev,
                        { name: '', type: 'string', description: '', required: false },
                      ])
                    }
                    className="rounded-sm px-2 py-1 text-[11px] text-accent-primary hover:bg-hover-bg cursor-pointer"
                  >
                    {t('actions.addCommandArg')}
                  </button>
                </div>
                {args.length === 0 ? (
                  <p className="text-[11px] text-text-tertiary">—</p>
                ) : (
                  <div className="space-y-2">
                    {args.map((arg, index) => (
                      <div
                        key={index}
                        className="rounded-sm border border-border-tertiary bg-bg-tertiary p-2.5 space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <label className="min-w-0 flex-1 text-[11px] text-text-secondary">
                            {t('actions.commandArgName')}
                            <input
                              value={arg.name}
                              onChange={(e) =>
                                updateArg(index, { name: sanitizeCapaIdInput(e.target.value) })
                              }
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 font-mono text-xs text-text-primary"
                            />
                          </label>
                          <label className="w-28 text-[11px] text-text-secondary">
                            {t('actions.commandArgType')}
                            <select
                              value={arg.type}
                              onChange={(e) =>
                                updateArg(index, {
                                  type: e.target.value as CommandArgDraft['type'],
                                })
                              }
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary"
                            >
                              <option value="string">string</option>
                              <option value="number">number</option>
                              <option value="boolean">boolean</option>
                              <option value="object">object</option>
                              <option value="array">array</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            title={t('actions.delete')}
                            onClick={() => setArgs((prev) => prev.filter((_, i) => i !== index))}
                            className="mt-5 rounded-sm p-1 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <label className="block text-[11px] text-text-secondary">
                          {t('actions.commandArgDescription')}
                          <input
                            value={arg.description}
                            onChange={(e) => updateArg(index, { description: e.target.value })}
                            className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                        <label className="inline-flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={arg.required}
                            onChange={(e) => updateArg(index, { required: e.target.checked })}
                          />
                          {t('actions.commandArgRequired')}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 shrink-0 border-t border-border-secondary pt-3">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {pending && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? t('actions.save') : t('actions.add')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
