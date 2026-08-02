import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X, Loader2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rule } from '../../../types/api';
import { matchesSearch } from '../../../lib/utils';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../lib/ids';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { sourceTypeBadgeClasses } from './sourceTypeColors';
import { renderMarkdown } from './registry-browse/markdown';
import { LocalPathPicker } from './LocalPathPicker';
import { useAppendCapability, useDeleteCapability, useReorderCapability, useUpdateCapability } from '../hooks';
import { authoredReorderKeys, isPluginSourced } from '../lib/reorderKeys';

interface RulesListProps {
  rules: Rule[];
  search: string;
  projectId: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function RulesList({ rules, search, projectId, addOpen, onAddOpenChange }: RulesListProps) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [viewing, setViewing] = useState<Rule | null>(null);
  const searching = !!search.trim();
  const visible = rules.filter((r) => matchesSearch([r.id, r.description, r.content, r.path], search));

  return (
    <div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noRulesMatch') : t('actions.emptyRules')}
        </div>
      ) : (
        <ReorderableList
          items={visible}
          getId={(r) => r.id}
          isLocked={(r) => isPluginSourced(r)}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) =>
            reorderMutation.mutate({
              section: 'rules',
              ids: authoredReorderKeys(rules, ids, (r) => r.id),
            })
          }
          renderItem={(rule, { handle, locked }) => (
            <div className="flex w-full items-stretch gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary pl-1">
              {handle}
              <button
                type="button"
                className="min-w-0 flex-1 p-3 text-left cursor-pointer ui-row-hover hover:bg-hover-bg"
                onClick={() => {
                  if (locked) {
                    setViewing(rule);
                    return;
                  }
                  if (rule.type === 'inline' || rule.type === 'local') setEditing(rule);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-medium text-text-primary">{rule.id}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${sourceTypeBadgeClasses(locked ? 'plugin' : rule.type)}`}>
                    {locked ? 'plugin' : rule.type}
                  </span>
                </div>
                {rule.description && (
                  <p className="mt-1 text-xs text-text-secondary">{rule.description}</p>
                )}
                {rule.path && (
                  <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary" title={rule.path}>
                    {rule.path}
                  </p>
                )}
                {rule.content && (
                  <p className="mt-1 line-clamp-2 font-mono text-[11px] text-text-tertiary">{rule.content}</p>
                )}
                {rule.sourcePlugin?.name && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                    <span>from</span>
                    <SourceBadge name={rule.sourcePlugin.name} kind="plugin" />
                  </div>
                )}
              </button>
              <div className="flex items-center pr-2">
                {locked ? (
                  <span title={t('actions.pluginLocked')} className="p-2 text-text-tertiary">
                    <Lock size={14} />
                  </span>
                ) : (
                  <button
                    type="button"
                    title={t('actions.delete')}
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (confirm(t('actions.confirmDeleteRule', { id: rule.id }))) {
                        deleteMutation.mutate({ section: 'rules', entryId: rule.id });
                      }
                    }}
                    className="rounded-sm p-2 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        />
      )}

      <RuleDialog
        open={(addOpen || !!editing) && !editing?.sourcePlugin}
        mode={editing ? 'edit' : 'add'}
        initial={editing?.sourcePlugin ? null : editing}
        busy={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            onAddOpenChange(false);
            setEditing(null);
          }
        }}
        onSubmit={async (entry) => {
          if (editing?.sourcePlugin) return;
          if (editing) {
            await updateMutation.mutateAsync({
              section: 'rules',
              entryId: editing.id,
              patch: entry,
            });
          }
        }}
        projectId={projectId}
        isEdit={!!editing && !editing.sourcePlugin}
      />

      <RuleViewDialog
        rule={viewing}
        open={!!viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
    </div>
  );
}

function RuleViewDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: Rule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('projects');
  const contentHtml = useMemo(
    () => (rule?.content ? renderMarkdown(rule.content) : ''),
    [rule?.content],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[90vh] w-[min(90vw,720px)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
          <div className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
            <div className="min-w-0 flex-1 pr-4">
              <Dialog.Title className="truncate font-mono text-lg font-medium text-text-primary">
                {rule?.id ?? t('rules.viewTitle')}
              </Dialog.Title>
              {rule && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${sourceTypeBadgeClasses('plugin')}`}
                  >
                    plugin
                  </span>
                  {rule.sourcePlugin?.name && (
                    <SourceBadge name={rule.sourcePlugin.name} kind="plugin" />
                  )}
                </div>
              )}
              <Dialog.Description className="sr-only">
                {t('rules.viewTitle')}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-hover-bg cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {rule?.description && (
              <p className="text-sm text-text-secondary">{rule.description}</p>
            )}

            {(rule?.appliesTo.length ?? 0) > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-text-tertiary">
                  {t('rules.appliesTo')}
                </div>
                <div className="flex flex-wrap gap-1">
                  {rule!.appliesTo.map((glob) => (
                    <span
                      key={glob}
                      className="rounded-sm bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary"
                    >
                      {glob}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rule?.alwaysApply && (
              <div className="text-xs text-text-tertiary">{t('rules.alwaysApply')}</div>
            )}

            <div>
              <div className="mb-1.5 text-xs font-medium text-text-tertiary">
                {t('rules.content')}
              </div>
              {contentHtml ? (
                <div
                  className="registry-markdown overflow-hidden text-sm text-text-secondary"
                  dangerouslySetInnerHTML={{ __html: contentHtml }}
                />
              ) : (
                <p className="text-xs text-text-tertiary">{t('rules.noContent')}</p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RuleDialog({
  open,
  mode,
  initial,
  onOpenChange,
  projectId,
  isEdit,
  onSubmit,
  busy,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  initial: Rule | null;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  isEdit: boolean;
  onSubmit: (entry: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation('projects');
  const appendMutation = useAppendCapability(projectId);
  const [sourceMode, setSourceMode] = useState<'inline' | 'local'>('inline');
  const [id, setId] = useState(initial?.id || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [content, setContent] = useState(initial?.content || '');
  const [path, setPath] = useState(initial?.path || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSourceMode(initial.type === 'local' ? 'local' : 'inline');
      setId(initial.id);
      setDescription(initial.description || '');
      setContent(initial.content || '');
      setPath(initial.path || '');
    } else {
      setSourceMode('inline');
      setId('');
      setDescription('');
      setContent('');
      setPath('');
    }
    setError(null);
  }, [open, initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }

    const useLocal = sourceMode === 'local';
    if (useLocal) {
      if (!id.trim() || !path.trim()) {
        setError(t('actions.ruleLocalRequired'));
        return;
      }
    } else if (!id.trim() || !content.trim()) {
      setError(t('actions.ruleRequired'));
      return;
    }

    const entry = useLocal
      ? {
          id: id.trim(),
          type: 'local' as const,
          description: description.trim() || undefined,
          path: path.trim(),
        }
      : {
          id: id.trim(),
          type: 'inline' as const,
          description: description.trim() || undefined,
          content: content.trim(),
        };

    try {
      if (isEdit) {
        await onSubmit(entry);
      } else {
        await appendMutation.mutateAsync({ section: 'rules', entry });
      }
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pending = busy || appendMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 w-[min(520px,92vw)] rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editRule') : t('actions.addRule')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {error && <p className="mb-3 text-xs text-error-text">{error}</p>}
          {!isEdit && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSourceMode('inline')}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  sourceMode === 'inline'
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'bg-bg-tertiary text-text-secondary'
                }`}
              >
                {t('actions.createInline')}
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('local')}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  sourceMode === 'local'
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'bg-bg-tertiary text-text-secondary'
                }`}
              >
                {t('actions.fromFile')}
              </button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs text-text-secondary">
              ID
              <input
                value={id}
                disabled={isEdit}
                onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary disabled:opacity-60"
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
            {sourceMode === 'local' ? (
              <div className="block text-xs text-text-secondary">
                {t('actions.ruleLocalPath')}
                <div className="mt-1">
                  <LocalPathPicker
                    projectId={projectId}
                    value={path}
                    onChange={setPath}
                    ext="md"
                    placeholder={t('actions.ruleLocalPathHint')}
                  />
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">{t('actions.ruleLocalPathHint')}</p>
              </div>
            ) : (
              <label className="block text-xs text-text-secondary">
                {t('actions.content')}
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary"
                />
              </label>
            )}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? t('actions.save') : t('actions.add')}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
