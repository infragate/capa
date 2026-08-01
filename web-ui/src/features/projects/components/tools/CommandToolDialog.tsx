import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tool } from '../../../../types/api';
import { useAppendCapability, useUpdateCapability } from '../../hooks';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../../lib/ids';

type CommandArgDraft = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  /** Raw text from the form; empty means no default. */
  defaultValue: string;
};

function defaultToDraft(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseDefaultValue(
  raw: string,
  type: CommandArgDraft['type'],
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };

  if (type === 'string') {
    return { ok: true, value: trimmed };
  }
  if (type === 'number') {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false };
    return { ok: true, value: n };
  }
  if (type === 'boolean') {
    if (trimmed === 'true') return { ok: true, value: true };
    if (trimmed === 'false') return { ok: true, value: false };
    return { ok: false };
  }
  // object / array — must be valid JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (type === 'array' && !Array.isArray(parsed)) return { ok: false };
    if (type === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

export function CommandToolDialog({
  projectId,
  open,
  tool,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  tool: Tool | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('projects');
  const appendMutation = useAppendCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const isEdit = !!tool;
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [group, setGroup] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState<CommandArgDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setId('');
    setDescription('');
    setGroup('');
    setCmd('');
    setArgs([]);
    setError(null);
  }

  function hydrateFromTool(source: Tool) {
    setId(source.id);
    setDescription(source.description || '');
    setGroup(source.group || '');
    setCmd(source.command || '');
    setArgs(
      (source.commandArgs || []).map((a) => ({
        name: a.name,
        type: (['string', 'number', 'boolean', 'object', 'array'].includes(a.type || '')
          ? a.type
          : 'string') as CommandArgDraft['type'],
        description: a.description || '',
        required: !!a.required,
        defaultValue: defaultToDraft(a.default),
      })),
    );
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    if (tool) hydrateFromTool(tool);
    else resetForm();
  }, [open, tool]);

  function updateArg(index: number, patch: Partial<CommandArgDraft>) {
    setArgs((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    if (!cmd.trim()) {
      setError(t('actions.commandToolRequired'));
      return;
    }
    for (const arg of args) {
      const argErr = capaIdErrorMessage(arg.name, t);
      if (argErr) {
        setError(`${t('actions.commandArgName')}: ${argErr}`);
        return;
      }
    }

    const serializedArgs: Array<Record<string, unknown>> = [];
    for (const a of args) {
      const parsed = parseDefaultValue(a.defaultValue, a.type);
      if (!parsed.ok) {
        setError(
          t('actions.commandArgDefaultInvalid', {
            name: a.name.trim() || '?',
            type: a.type,
          }),
        );
        return;
      }
      serializedArgs.push({
        name: a.name.trim(),
        type: a.type,
        ...(a.description.trim() ? { description: a.description.trim() } : {}),
        ...(a.required ? { required: true } : { required: false }),
        ...(parsed.value !== undefined ? { default: parsed.value } : {}),
      });
    }

    const entry: Record<string, unknown> = {
      id: id.trim(),
      type: 'command',
      description: description.trim() || null,
      group: group.trim() || null,
      def: {
        run: {
          cmd: cmd.trim(),
          args: serializedArgs,
        },
      },
    };
    try {
      if (isEdit && tool) {
        await updateMutation.mutateAsync({
          section: 'tools',
          entryId: tool.id,
          patch: entry,
        });
      } else {
        await appendMutation.mutateAsync({ section: 'tools', entry });
      }
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pending = appendMutation.isPending || updateMutation.isPending;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[min(90vh,720px)] w-[min(560px,92vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editCommandTool') : t('actions.addCommandTool')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {error && <p className="mb-3 shrink-0 text-xs text-error-text">{error}</p>}
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <label className="block text-xs text-text-secondary">
                ID
                <input
                  value={id}
                  onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
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
                {t('actions.commandToolGroup')}
                <input
                  value={group}
                  onChange={(e) => setGroup(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
                <span className="mt-0.5 block text-[10px] text-text-tertiary">
                  {t('actions.commandToolGroupHint')}
                </span>
              </label>
              <label className="block text-xs text-text-secondary">
                {t('actions.commandToolCmd')}
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  placeholder='echo Hello, {name}!'
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
                <span className="mt-0.5 block text-[10px] text-text-tertiary">
                  {t('actions.commandToolCmdHint')}
                </span>
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{t('actions.commandToolArgs')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setArgs((prev) => [
                        ...prev,
                        {
                          name: '',
                          type: 'string',
                          description: '',
                          required: false,
                          defaultValue: '',
                        },
                      ])
                    }
                    className="rounded-sm px-2 py-1 text-[11px] text-accent-primary hover:bg-hover-bg cursor-pointer"
                  >
                    {t('actions.addCommandArg')}
                  </button>
                </div>
                {args.length === 0 ? (
                  <p className="text-[11px] text-text-tertiary">—</p>
                ) : (
                  <div className="space-y-2">
                    {args.map((arg, index) => (
                      <div
                        key={index}
                        className="rounded-sm border border-border-tertiary bg-bg-tertiary p-2.5 space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <label className="min-w-0 flex-1 text-[11px] text-text-secondary">
                            {t('actions.commandArgName')}
                            <input
                              value={arg.name}
                              onChange={(e) =>
                                updateArg(index, { name: sanitizeCapaIdInput(e.target.value) })
                              }
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 font-mono text-xs text-text-primary"
                            />
                          </label>
                          <label className="w-28 text-[11px] text-text-secondary">
                            {t('actions.commandArgType')}
                            <select
                              value={arg.type}
                              onChange={(e) =>
                                updateArg(index, {
                                  type: e.target.value as CommandArgDraft['type'],
                                })
                              }
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary"
                            >
                              <option value="string">string</option>
                              <option value="number">number</option>
                              <option value="boolean">boolean</option>
                              <option value="object">object</option>
                              <option value="array">array</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            title={t('actions.delete')}
                            onClick={() => setArgs((prev) => prev.filter((_, i) => i !== index))}
                            className="mt-5 rounded-sm p-1 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <label className="block text-[11px] text-text-secondary">
                          {t('actions.commandArgDescription')}
                          <input
                            value={arg.description}
                            onChange={(e) => updateArg(index, { description: e.target.value })}
                            className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                        <label className="block text-[11px] text-text-secondary">
                          {t('actions.commandArgDefault')}
                          {arg.type === 'boolean' ? (
                            <select
                              value={arg.defaultValue}
                              onChange={(e) => updateArg(index, { defaultValue: e.target.value })}
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 font-mono text-xs text-text-primary"
                            >
                              <option value="">—</option>
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              value={arg.defaultValue}
                              onChange={(e) => updateArg(index, { defaultValue: e.target.value })}
                              placeholder={
                                arg.type === 'number'
                                  ? '0'
                                  : arg.type === 'object'
                                    ? '{"key":"value"}'
                                    : arg.type === 'array'
                                      ? '[]'
                                      : ''
                              }
                              className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-2 py-1.5 font-mono text-xs text-text-primary"
                            />
                          )}
                          <span className="mt-0.5 block text-[10px] text-text-tertiary">
                            {t('actions.commandArgDefaultHint')}
                          </span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={arg.required}
                            onChange={(e) => updateArg(index, { required: e.target.checked })}
                          />
                          {t('actions.commandArgRequired')}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 shrink-0 border-t border-border-secondary pt-3">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {pending && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? t('actions.save') : t('actions.add')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
