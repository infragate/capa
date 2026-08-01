import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentFileConfig, AgentSnippet } from '../../../../types/api';
import { sourceTypeBadgeClasses } from '../sourceTypeColors';
import { usePutAgents } from '../../hooks';
import { normalizeAgents, toWritableAgents } from './normalize';
import { BaseDialog } from './BaseDialog';
import { SnippetDialog } from './SnippetDialog';

interface AgentsEditorProps {
  agents: AgentFileConfig | null;
  search: string;
  projectId: string;
}

export function AgentsEditor({ agents, search, projectId }: AgentsEditorProps) {
  const { t } = useTranslation('projects');
  const putMutation = usePutAgents(projectId);
  const [editBaseOpen, setEditBaseOpen] = useState(false);
  const [snippetDialog, setSnippetDialog] = useState<'add' | AgentSnippet | null>(null);

  const current = normalizeAgents(agents);
  const q = search.trim().toLowerCase();
  const snippets = current.additional.filter((s) => {
    if (!q) return true;
    return [s.id, s.content, s.path, s.url].some((v) => v?.toLowerCase().includes(q));
  });

  async function save(next: AgentFileConfig) {
    await putMutation.mutateAsync(toWritableAgents(next));
  }

  async function clearAll() {
    if (!confirm(t('actions.confirmClearAgents'))) return;
    await putMutation.mutateAsync(null);
  }

  const hasConfig = !!(current.base || current.additional.length > 0);
  const baseLabel = current.base
    ? current.base.path || current.base.ref || current.base.type || t('agents.configured')
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-border-tertiary bg-bg-tertiary p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-text-primary">{t('agents.base')}</h3>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditBaseOpen(true)}
              className="rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-hover-bg cursor-pointer"
            >
              {current.base ? t('actions.edit') : t('actions.add')}
            </button>
            {current.base && (
              <button
                type="button"
                disabled={putMutation.isPending}
                onClick={() => void save({ ...current, base: null })}
                className="rounded-sm p-1 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                title={t('actions.delete')}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        {current.base ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${sourceTypeBadgeClasses(current.base.type || 'local')}`}
            >
              {current.base.type || 'local'}
            </span>
            <span className="truncate font-mono text-[11px] text-text-secondary" title={baseLabel || undefined}>
              {baseLabel}
            </span>
          </div>
        ) : (
          <p className="text-xs text-text-tertiary">{t('agents.noBase')}</p>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-primary">{t('agents.additional')}</h3>
          <button
            type="button"
            onClick={() => setSnippetDialog('add')}
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-hover-bg cursor-pointer"
          >
            <Plus size={12} />
            {t('actions.add')}
          </button>
        </div>
        {snippets.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-tertiary">
            {search ? t('detail.noAgentsMatch') : t('actions.emptyAgentSnippets')}
          </p>
        ) : (
          <ul className="space-y-2">
            {snippets.map((snippet, idx) => (
              <li
                key={snippet.id || `snippet-${idx}`}
                className="flex items-start gap-2 rounded-sm border border-border-tertiary bg-bg-tertiary p-3"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left cursor-pointer"
                  onClick={() => setSnippetDialog(snippet)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-medium text-text-primary">
                      {snippet.id || '—'}
                    </span>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${sourceTypeBadgeClasses(snippet.type)}`}
                    >
                      {snippet.type}
                    </span>
                  </div>
                  {snippet.path && (
                    <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{snippet.path}</p>
                  )}
                  {snippet.content && (
                    <p className="mt-1 line-clamp-2 font-mono text-[11px] text-text-tertiary">{snippet.content}</p>
                  )}
                </button>
                <button
                  type="button"
                  title={t('actions.delete')}
                  disabled={putMutation.isPending}
                  onClick={async () => {
                    if (!confirm(t('actions.confirmDeleteAgentSnippet', { id: snippet.id || '' }))) return;
                    await save({
                      ...current,
                      additional: current.additional.filter((s) => s !== snippet),
                    });
                  }}
                  className="rounded-sm p-2 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasConfig && (
        <button
          type="button"
          disabled={putMutation.isPending}
          onClick={() => void clearAll()}
          className="text-[11px] text-text-tertiary hover:text-error-text cursor-pointer"
        >
          {t('actions.clearAgents')}
        </button>
      )}

      <BaseDialog
        open={editBaseOpen}
        projectId={projectId}
        initial={current.base}
        busy={putMutation.isPending}
        onOpenChange={setEditBaseOpen}
        onSave={async (base) => {
          await save({ ...current, base });
        }}
      />

      <SnippetDialog
        open={snippetDialog !== null}
        mode={snippetDialog === 'add' || snippetDialog === null ? 'add' : 'edit'}
        initial={snippetDialog && snippetDialog !== 'add' ? snippetDialog : null}
        projectId={projectId}
        busy={putMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setSnippetDialog(null);
        }}
        onSave={async (entry, previous) => {
          const nextAdditional = previous
            ? current.additional.map((s) => (s === previous ? entry : s))
            : [...current.additional, entry];
          await save({ ...current, additional: nextAdditional });
        }}
      />
    </div>
  );
}
