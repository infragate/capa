import { useTranslation } from 'react-i18next';
import type { Server, ToolSchema } from '../../../../types/api';
import { matchesSearch } from '../../../../lib/utils';
import { useReorderCapability } from '../../hooks';
import { ReorderableList } from '../../../../components/common/ReorderableList';
import { isPluginSourced, serverReorderKey } from '../../lib/reorderKeys';
import { toolMatchesSearch } from './anchors';
import { ServerCard } from './ServerCard';

export function ServersPanel({
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
          getId={(s) => serverReorderKey(s)}
          isLocked={(s) => isPluginSourced(s)}
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
