import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AuthoredPlugin, ResolvedPlugin } from '../../../types/api';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { useDeleteCapability, useReorderCapability } from '../hooks';
import { PluginPreviewDialog } from './PluginPreviewDialog';

interface PluginsEditorProps {
  authored: AuthoredPlugin[];
  resolved: ResolvedPlugin[];
  projectId: string;
}

function PluginRow({
  plugin,
  resolvedInfo,
  handle,
  onPreview,
  onDelete,
  deleting,
  deleteTitle,
  confirmDelete,
  derivedNote,
}: {
  plugin: AuthoredPlugin;
  resolvedInfo?: ResolvedPlugin;
  handle?: ReactNode;
  onPreview: () => void;
  onDelete?: () => void;
  deleting: boolean;
  deleteTitle: string;
  confirmDelete: string;
  derivedNote: string;
}) {
  return (
    <div className="flex items-start gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary pl-1">
      {handle}
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 p-3 text-left transition-colors hover:bg-hover-bg cursor-pointer"
      >
        <div className="mb-1">
          <SourceBadge name={plugin.id || plugin.def.repo} kind="plugin" />
        </div>
        <div className="font-mono text-[11px] text-text-tertiary">{plugin.def.repo}</div>
        {resolvedInfo?.version && (
          <div className="mt-1 text-[11px] text-text-secondary">{resolvedInfo.version}</div>
        )}
        <p className="mt-2 text-[11px] text-text-tertiary">{derivedNote}</p>
      </button>
      {plugin.id && onDelete && (
        <div className="flex items-center pr-2 pt-3">
          <button
            type="button"
            title={deleteTitle}
            disabled={deleting}
            onClick={() => {
              if (confirm(confirmDelete)) onDelete();
            }}
            className="rounded-sm p-2 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function PluginsEditor({ authored, resolved, projectId }: PluginsEditorProps) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const [previewPlugin, setPreviewPlugin] = useState<AuthoredPlugin | null>(null);

  const withId = authored.filter((p): p is AuthoredPlugin & { id: string } => !!p.id);
  const withoutId = authored.filter((p) => !p.id);

  const previewResolved = previewPlugin
    ? resolved.find(
        (r) =>
          r.name === previewPlugin.id ||
          r.repository?.includes(previewPlugin.def.repo.split('@')[0]),
      )
    : undefined;

  function resolveInfo(plugin: AuthoredPlugin) {
    return resolved.find(
      (r) => r.name === plugin.id || r.repository?.includes(plugin.def.repo.split('@')[0]),
    );
  }

  return (
    <div>
      {authored.length === 0 && resolved.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">{t('actions.emptyPlugins')}</div>
      ) : (
        <div className="space-y-2">
          {withId.length > 0 && (
            <ReorderableList
              items={withId}
              getId={(p) => p.id}
              handleLabel={t('actions.dragToReorder')}
              className="space-y-2"
              onReorder={(ids) => reorderMutation.mutate({ section: 'plugins', ids })}
              renderItem={(plugin, { handle }) => (
                <PluginRow
                  plugin={plugin}
                  resolvedInfo={resolveInfo(plugin)}
                  handle={handle}
                  onPreview={() => setPreviewPlugin(plugin)}
                  onDelete={() =>
                    deleteMutation.mutate({ section: 'plugins', entryId: plugin.id })
                  }
                  deleting={deleteMutation.isPending}
                  deleteTitle={t('actions.delete')}
                  confirmDelete={t('actions.confirmDeletePlugin', { id: plugin.id })}
                  derivedNote={t('actions.pluginDerivedNote')}
                />
              )}
            />
          )}
          {withoutId.map((plugin) => (
            <PluginRow
              key={plugin.def.repo}
              plugin={plugin}
              resolvedInfo={resolveInfo(plugin)}
              onPreview={() => setPreviewPlugin(plugin)}
              deleting={deleteMutation.isPending}
              deleteTitle={t('actions.delete')}
              confirmDelete=""
              derivedNote={t('actions.pluginDerivedNote')}
            />
          ))}
        </div>
      )}

      <PluginPreviewDialog
        open={!!previewPlugin}
        onOpenChange={(open) => {
          if (!open) setPreviewPlugin(null);
        }}
        plugin={previewPlugin}
        resolved={previewResolved}
      />
    </div>
  );
}
