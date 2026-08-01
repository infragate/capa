import { useMemo, type ReactNode } from 'react';
import {
  ChevronRight,
  Trash2,
  Lock,
  Plus,
  Check,
  Link2,
  Unlink,
  Pencil,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Server, ToolSchema } from '../../../../types/api';
import { highlightText, matchesSearch } from '../../../../lib/utils';
import { Spinner } from '../../../../components/common/Spinner';
import {
  useAppendCapability,
  useDeleteCapability,
  useDisconnectOAuth,
  useStartOAuth,
} from '../../hooks';
import { remoteToolAnchor, serverAnchor, suggestConfiguredToolId, toolMatchesSearch } from './anchors';

export function ServerCard({
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
