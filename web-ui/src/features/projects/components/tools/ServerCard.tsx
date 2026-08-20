import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Trash2,
  Plus,
  Check,
  Link2,
  Unlink,
  Pencil,
  Loader2,
  Power,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Server, ToolSchema } from '../../../../types/api';
import { highlightText, isFormFieldTarget, matchesSearch } from '../../../../lib/utils';
import { Spinner } from '../../../../components/common/Spinner';
import { Switch } from '../../../../components/common/Switch';
import {
  useAppendCapability,
  useDeleteCapability,
  useDisconnectOAuth,
  useSetServerEnabled,
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
  const setServerEnabled = useSetServerEnabled(projectId);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  const configLocked = !!server.sourcePlugin;
  const label = server.displayName || server.id;
  const togglingEnabled = setServerEnabled.isPending;
  const isOn =
    togglingEnabled && setServerEnabled.variables != null
      ? setServerEnabled.variables.enabled
      : server.enabled === true;
  const mutating =
    appendMutation.isPending ||
    deleteMutation.isPending ||
    startOAuth.isPending ||
    disconnectOAuth.isPending ||
    setServerEnabled.isPending;

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

  async function handleToggleEnabled() {
    setToggleError(null);
    try {
      await setServerEnabled.mutateAsync({ serverId: server.id, enabled: !isOn });
    } catch (err) {
      setToggleError((err as Error).message || t('actions.serverToggleFailed'));
    }
  }

  async function handleUseTool(tool: ToolSchema) {
    setPendingToolName(tool.name);
    try {
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
    } finally {
      setPendingToolName(null);
    }
  }

  return (
    <div
      className={`rounded-sm border border-border-tertiary bg-bg-tertiary ${!isOn ? 'opacity-80' : ''}`}
      data-link-anchor={serverAnchor(server.id)}
    >
      <div className="flex items-center gap-1 p-2">
        {dragHandle}
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 self-center rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer"
        >
          <ChevronRight
            size={14}
            className="ui-chevron"
            data-open={expanded ? 'true' : 'false'}
          />
        </button>
        <div className="flex shrink-0 items-center self-center mx-1.5">
          <Switch
            checked={isOn}
            disabled={mutating}
            loading={togglingEnabled}
            onCheckedChange={() => void handleToggleEnabled()}
            aria-label={isOn ? t('actions.turnOff') : t('actions.turnOn')}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-xs font-medium text-text-primary"
              dangerouslySetInnerHTML={{ __html: highlightText(label, search) }}
            />
            {!isOn && (
              <span className="rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                {t('actions.serverOff')}
              </span>
            )}
            {server.requiresOAuth && (
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[10px] ${
                  server.isConnected
                    ? 'bg-success-bg text-success-text'
                    : 'bg-[hsl(40_80%_50%/0.15)] text-[hsl(40_80%_45%)]'
                }`}
              >
                {server.isConnected ? t('actions.authenticated') : t('actions.needsOAuth')}
              </span>
            )}
          </div>
          {(server.url || server.cmd) && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
              {server.url || [server.cmd, ...(server.args || [])].join(' ')}
            </div>
          )}
          {toggleError ? (
            <p className="mt-1 text-[11px] text-error-text">{toggleError}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 self-center">
          {server.requiresOAuth && !server.isConnected && (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={mutating}
              className="inline-flex items-center gap-1 rounded-sm border border-accent-primary bg-accent-primary px-2 py-1 text-[11px] font-medium text-bg-secondary cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {startOAuth.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Link2 size={12} />
              )}
              {t('actions.authenticate')}
            </button>
          )}
          {server.requiresOAuth && server.isConnected && (
            <button
              type="button"
              disabled={mutating}
              title={t('actions.logout')}
              aria-label={t('actions.logout')}
              onClick={() => {
                if (confirm(t('oauth.confirmLogout', { name: label }))) {
                  disconnectOAuth.mutate(server.id);
                }
              }}
              className="inline-flex items-center justify-center rounded-sm border border-error-border bg-error-bg p-1.5 text-error-text cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {disconnectOAuth.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Unlink size={14} />
              )}
            </button>
          )}
          <button
            type="button"
            title={configLocked ? t('actions.pluginLocked') : t('actions.editServer')}
            disabled={mutating || configLocked}
            onClick={(e) => {
              if (configLocked) return;
              e.stopPropagation();
              onEdit();
            }}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title={configLocked ? t('actions.pluginLocked') : t('actions.delete')}
            disabled={mutating || configLocked}
            onClick={() => {
              if (configLocked) return;
              const cascade = confirm(t('actions.confirmDeleteServer', { id: server.id }));
              if (!cascade) return;
              const alsoTools = confirm(t('actions.cascadeTools'));
              deleteMutation.mutate({
                section: 'servers',
                entryId: server.id,
                cascadeTools: alsoTools,
              });
            }}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-secondary px-2 pb-2 pt-2">
          {!isOn ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <p className="text-[11px] text-text-tertiary">{t('tool.turnOnFirst')}</p>
              <button
                type="button"
                onClick={() => void handleToggleEnabled()}
                disabled={mutating}
                className="inline-flex items-center gap-1 rounded-sm border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-medium text-bg-secondary cursor-pointer hover:opacity-90 disabled:opacity-50"
              >
                {togglingEnabled ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Power size={12} />
                )}
                {t('actions.turnOn')}
              </button>
            </div>
          ) : server.requiresOAuth && !server.isConnected ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <p className="text-[11px] text-text-tertiary">{t('tool.authenticateFirst')}</p>
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={mutating}
                className="inline-flex items-center gap-1 rounded-sm border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-medium text-bg-secondary cursor-pointer hover:opacity-90 disabled:opacity-50"
              >
                {startOAuth.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Link2 size={12} />
                )}
                {t('actions.authenticate')}
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
                const adding = pendingToolName === tool.name;
                return (
                  <div
                    key={`${server.id}::${tool.name}`}
                    data-link-anchor={anchor}
                    role="button"
                    tabIndex={0}
                    aria-pressed={focused}
                    aria-busy={adding}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAnchor(anchor);
                    }}
                    onKeyDown={(e) => {
                      if (isFormFieldTarget(e.target)) return;
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
                    } ${adding ? 'opacity-80' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-mono text-[11px] font-medium text-text-primary"
                        dangerouslySetInnerHTML={{ __html: highlightText(tool.name, search) }}
                      />
                      {tool.description && (
                        <div
                          className={`mt-0.5 text-[10px] text-text-secondary ${
                            focused ? '' : 'line-clamp-2'
                          }`}
                          dangerouslySetInnerHTML={{
                            __html: highlightText(tool.description, search),
                          }}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={inUse || mutating}
                      title={inUse ? t('actions.toolInUse') : t('actions.useTool')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUseTool(tool);
                      }}
                      className={`shrink-0 rounded-sm p-1.5 cursor-pointer disabled:cursor-default disabled:opacity-50 ${
                        inUse
                          ? 'text-success-text'
                          : 'text-text-tertiary hover:bg-hover-bg hover:text-text-primary'
                      }`}
                    >
                      {adding ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : inUse ? (
                        <Check size={14} />
                      ) : (
                        <Plus size={14} />
                      )}
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
