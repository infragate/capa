import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTool, Server, Skill, Tool, ToolSchema } from '../../../../types/api';
import { matchesSearch } from '../../../../lib/utils';
import { useQueries } from '@tanstack/react-query';
import { projectsApi } from '../../api';
import { TokenSavingsBar } from '../TokenSavingsBar';
import { computeTokenSavings } from '../tokenStats';
import { refMatchesTool } from '../../../../lib/toolRefs';
import {
  configuredToolAnchor,
  remoteToolAnchor,
  serverAnchor,
  filterLinksForFocus,
  toolMatchesSearch,
  type ToolLink,
} from './anchors';
import { ToolLinkOverlay } from './ToolLinkOverlay';
import { ServersPanel } from './ServersPanel';
import { ConfiguredToolsPanel } from './ConfiguredToolsPanel';
import { ServerDialog } from './ServerDialog';
import { CommandToolDialog } from './CommandToolDialog';

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
