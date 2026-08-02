import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X, Loader2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Hook } from '../../../types/api';
import { matchesSearch } from '../../../lib/utils';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../lib/ids';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { sourceTypeBadgeClasses } from './sourceTypeColors';
import { useAppendCapability, useDeleteCapability, useReorderCapability, useUpdateCapability } from '../hooks';
import { authoredReorderKeys, isPluginSourced } from '../lib/reorderKeys';

const HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'beforeTool',
  'afterTool',
  'afterToolFailure',
  'beforeShell',
  'afterShell',
  'beforeFileRead',
  'afterFileEdit',
  'beforeMcpCall',
  'afterMcpCall',
  'subagentStart',
  'subagentStop',
  'preCompact',
  'stop',
];

function hookBody(hook: Hook | null | undefined): string {
  if (!hook) return '';
  return hook.command || hook.prompt || hook.sourceContent || '';
}

interface HooksListProps {
  hooks: Hook[];
  search: string;
  projectId: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function HooksList({ hooks, search, projectId, addOpen, onAddOpenChange }: HooksListProps) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const [editing, setEditing] = useState<Hook | null>(null);
  const searching = !!search.trim();
  const visible = hooks.filter((h) =>
    matchesSearch([h.id, h.description, h.on, h.command, h.prompt, h.sourceContent], search),
  );

  return (
    <div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noHooksMatch') : t('actions.emptyHooks')}
        </div>
      ) : (
        <ReorderableList
          items={visible}
          getId={(h) => h.id}
          isLocked={(h) => isPluginSourced(h)}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) =>
            reorderMutation.mutate({
              section: 'hooks',
              ids: authoredReorderKeys(hooks, ids, (h) => h.id),
            })
          }
          renderItem={(hook, { handle, locked }) => (
            <div className="flex w-full items-stretch gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary pl-1">
              {handle}
              <button
                type="button"
                className={`min-w-0 flex-1 p-3 text-left ${locked ? 'cursor-default' : 'cursor-pointer ui-row-hover hover:bg-hover-bg'}`}
                onClick={() => !locked && setEditing(hook)}
                disabled={locked}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-medium text-text-primary">{hook.id}</span>
                  {locked && (
                    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${sourceTypeBadgeClasses('plugin')}`}>
                      plugin
                    </span>
                  )}
                  <span className="rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                    {hook.on}
                  </span>
                  <span className="rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary">
                    {hook.type}
                  </span>
                </div>
                {hook.description && (
                  <p className="mt-1 text-xs text-text-secondary">{hook.description}</p>
                )}
                {hookBody(hook) && (
                  <p className="mt-1 line-clamp-2 font-mono text-[11px] text-text-tertiary">
                    {hookBody(hook)}
                  </p>
                )}
                {hook.sourcePlugin?.name && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                    <span>from</span>
                    <SourceBadge name={hook.sourcePlugin.name} kind="plugin" />
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
                      if (confirm(t('actions.confirmDeleteHook', { id: hook.id }))) {
                        deleteMutation.mutate({ section: 'hooks', entryId: hook.id });
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

      <HookDialog
        open={(addOpen || !!editing) && !editing?.sourcePlugin}
        initial={editing?.sourcePlugin ? null : editing}
        projectId={projectId}
        busy={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            onAddOpenChange(false);
            setEditing(null);
          }
        }}
        onUpdate={async (entryId, patch) => {
          if (editing?.sourcePlugin) return;
          await updateMutation.mutateAsync({ section: 'hooks', entryId, patch });
        }}
      />
    </div>
  );
}

function HookDialog({
  open,
  initial,
  projectId,
  onOpenChange,
  onUpdate,
  busy,
}: {
  open: boolean;
  initial: Hook | null;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onUpdate: (entryId: string, patch: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation('projects');
  const appendMutation = useAppendCapability(projectId);
  const isEdit = !!initial;
  const [id, setId] = useState('');
  const [onEvent, setOnEvent] = useState('sessionStart');
  const [type, setType] = useState<'command' | 'prompt'>('command');
  const [body, setBody] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setId(initial.id);
      setOnEvent(initial.on || 'sessionStart');
      setType(initial.type || 'command');
      setBody(hookBody(initial));
      setDescription(initial.description || '');
    } else {
      setId('');
      setOnEvent('sessionStart');
      setType('command');
      setBody('');
      setDescription('');
    }
    setError(null);
  }, [open, initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!id.trim() || !body.trim()) {
      setError(t('actions.hookRequired'));
      return;
    }
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    const entry: Record<string, unknown> = {
      id: id.trim(),
      on: onEvent,
      type,
      description: description.trim() || undefined,
      ...(type === 'command' ? { command: body.trim() } : { prompt: body.trim() }),
    };
    try {
      if (isEdit && initial) {
        await onUpdate(initial.id, entry);
      } else {
        await appendMutation.mutateAsync({ section: 'hooks', entry });
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
              {isEdit ? t('actions.editHook') : t('actions.addHook')}
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
              Event
              <select
                value={onEvent}
                onChange={(e) => setOnEvent(e.target.value)}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-text-secondary">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'command' | 'prompt')}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
              >
                <option value="command">command</option>
                <option value="prompt">prompt</option>
              </select>
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
              {type === 'command' ? 'Command' : 'Prompt'}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
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
