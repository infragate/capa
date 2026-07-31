import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rule } from '../../../types/api';
import { matchesSearch } from '../../../lib/utils';
import { capaIdIssue, sanitizeCapaIdInput } from '../../../lib/ids';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { sourceTypeBadgeClasses } from './sourceTypeColors';
import { useAppendCapability, useDeleteCapability, useReorderCapability, useUpdateCapability } from '../hooks';

function capaIdErrorMessage(id: string, t: (key: string) => string): string | null {
  const issue = capaIdIssue(id);
  if (!issue) return null;
  if (issue === 'empty') return t('actions.idInvalidEmpty');
  if (issue === 'invalidStart') return t('actions.idInvalidStart');
  return t('actions.idInvalidChars');
}

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
  const searching = !!search.trim();
  const visible = rules.filter((r) => matchesSearch([r.id, r.description, r.content], search));

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
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'rules', ids })}
          renderItem={(rule, { handle }) => (
            <div className="flex items-start gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary p-3 pl-1">
              {handle}
              <button
                type="button"
                className="min-w-0 flex-1 text-left cursor-pointer"
                onClick={() => rule.type === 'inline' && setEditing(rule)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-medium text-text-primary">{rule.id}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${sourceTypeBadgeClasses(rule.type)}`}>
                    {rule.type}
                  </span>
                </div>
                {rule.description && (
                  <p className="mt-1 text-xs text-text-secondary">{rule.description}</p>
                )}
                {rule.content && (
                  <p className="mt-1 line-clamp-2 font-mono text-[11px] text-text-tertiary">{rule.content}</p>
                )}
              </button>
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
            </div>
          )}
        />
      )}

      <RuleDialog
        open={addOpen || !!editing}
        mode={editing ? 'edit' : 'add'}
        initial={editing}
        busy={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            onAddOpenChange(false);
            setEditing(null);
          }
        }}
        onSubmit={async (entry) => {
          if (editing) {
            await updateMutation.mutateAsync({
              section: 'rules',
              entryId: editing.id,
              patch: entry,
            });
          } else {
            // handled in dialog via append
          }
        }}
        projectId={projectId}
        isEdit={!!editing}
      />
    </div>
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
  const [id, setId] = useState(initial?.id || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [content, setContent] = useState(initial?.content || '');
  const [error, setError] = useState<string | null>(null);

  // sync when opening
  if (open && initial && id !== initial.id && mode === 'edit') {
    // controlled reset via key on parent is cleaner — use effect-free key approach
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!id.trim() || !content.trim()) {
      setError(t('actions.ruleRequired'));
      return;
    }
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    const entry = {
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
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next && !isEdit) {
          setId('');
          setDescription('');
          setContent('');
          setError(null);
        } else if (next && initial) {
          setId(initial.id);
          setDescription(initial.description || '');
          setContent(initial.content || '');
          setError(null);
        }
        onOpenChange(next);
      }}
    >
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
            <label className="block text-xs text-text-secondary">
              {t('actions.content')}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary"
              />
            </label>
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
