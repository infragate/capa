import { useState, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Server, ToolSchema } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { ServerToolsPanel } from './ServerToolsPanel';

function toolMatchesSearch(tool: ToolSchema, query: string): boolean {
  const paramTexts = Object.entries(tool.inputSchema?.properties || {}).flatMap(
    ([name, s]) => [name, s.description || ''],
  );
  return matchesSearch([tool.name, tool.description, ...paramTexts], query);
}

interface ServersListProps {
  servers: Server[];
  search: string;
  projectId: string;
  serverToolsMap: Record<string, ToolSchema[]>;
}

export function ServersList({ servers, search, projectId, serverToolsMap }: ServersListProps) {
  const { t } = useTranslation('projects');

  const visible = servers.filter((server) => {
    const cmdStr = server.cmd ? [server.cmd, ...(server.args || [])].join(' ') : '';
    const connStatus = server.requiresOAuth && server.isConnected === false ? 'disconnected' : '';
    if (matchesSearch(
      [server.id, server.displayName, server.url, cmdStr, server.description, connStatus],
      search,
    )) {
      return true;
    }
    if (search) {
      const tools = serverToolsMap[server.id] || [];
      return tools.some((tool) => toolMatchesSearch(tool, search));
    }
    return false;
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
        <span>{t('detail.sections.servers')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noServersMatch') : t('detail.noServers')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((server) => (
            <ServerItem
              key={server.id}
              server={server}
              search={search}
              projectId={projectId}
              tools={serverToolsMap[server.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerItem({
  server,
  search,
  projectId,
  tools,
}: {
  server: Server;
  search: string;
  projectId: string;
  tools?: ToolSchema[];
}) {
  const { t } = useTranslation();

  const hasToolMatch = useMemo(() => {
    if (!search || !tools) return false;
    return tools.some((tool) => toolMatchesSearch(tool, search));
  }, [search, tools]);

  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle ?? hasToolMatch;

  useEffect(() => {
    setManualToggle(null);
  }, [search]);

  const connectionText = (() => {
    if (server.url) return server.url;
    if (server.cmd) {
      return server.args?.length ? `${server.cmd} ${server.args.join(' ')}` : server.cmd;
    }
    return null;
  })();

  return (
    <div className="rounded-sm border border-border-tertiary bg-bg-tertiary p-3">
      <div className="mb-1 flex items-center gap-2">
        <SourceBadge name={server.displayName || server.id} kind="server" search={search} />
        {server.requiresOAuth && server.isConnected === false && (
          <span className="rounded-sm bg-error-bg px-1.5 py-0.5 text-[10px] font-medium text-error-text">
            Disconnected
          </span>
        )}
      </div>
      <div className="mb-1 flex items-center gap-2 text-xs text-text-secondary min-w-0">
        <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[11px] font-medium uppercase">
          {server.type}
        </span>
        {connectionText && (
          <>
            <span className="shrink-0 text-text-tertiary">&bull;</span>
            <span
              className={`font-mono text-[11px] ${expanded ? 'break-all' : 'truncate'}`}
              title={connectionText}
              dangerouslySetInnerHTML={{ __html: highlightText(connectionText, search) }}
            />
          </>
        )}
      </div>
      {server.description && (
        <div
          className="mt-1 break-words text-xs leading-relaxed text-text-secondary"
          dangerouslySetInnerHTML={{ __html: highlightText(server.description, search) }}
        />
      )}
      {server.sourcePlugin?.name && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span>from</span>
          <SourceBadge name={server.sourcePlugin.name} kind="plugin" />
        </div>
      )}
      <button
        onClick={() => setManualToggle(expanded ? false : true)}
        className="mt-2 flex items-center gap-1 rounded-sm border-0 bg-transparent px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg cursor-pointer"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
        <span>{expanded ? t('actions.hideTools') : t('actions.showTools')}</span>
      </button>
      {expanded && (
        <ServerToolsPanel projectId={projectId} serverId={server.id} search={search} prefetchedTools={tools} />
      )}
    </div>
  );
}
