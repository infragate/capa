import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentFileBase, AgentFileConfig, AgentSnippet } from '../../../types/api';
import { capaIdIssue, sanitizeCapaIdInput } from '../../../lib/ids';
import { sourceTypeBadgeClasses } from './sourceTypeColors';
import { LocalPathPicker } from './LocalPathPicker';
import { projectsApi } from '../api';
import { usePutAgents } from '../hooks';

function capaIdErrorMessage(id: string, t: (key: string) => string): string | null {
  const issue = capaIdIssue(id);
  if (!issue) return null;
  if (issue === 'empty') return t('actions.idInvalidEmpty');
  if (issue === 'invalidStart') return t('actions.idInvalidStart');
  return t('actions.idInvalidChars');
}

function normalizeAgents(agents: AgentFileConfig | null): AgentFileConfig {
  return {
    base: agents?.base ?? null,
    additional: agents?.additional ?? [],
  };
}

/** Strip nullish fields so YAML stays clean. */
function toWritableAgents(next: AgentFileConfig): AgentFileConfig | null {
  const additional = next.additional
    .map((s) => {
      const out: Record<string, unknown> = { type: s.type };
      if (s.id) out.id = s.id;
      if (s.type === 'inline' && s.content) out.content = s.content;
      if (s.type === 'local' && s.path) out.path = s.path;
      if (s.type === 'remote' && s.url) out.url = s.url;
      if ((s.type === 'github' || s.type === 'gitlab') && s.def) out.def = s.def;
      return out;
    })
    .filter((s) => s.type);

  let base: Record<string, unknown> | undefined;
  if (next.base) {
    base = {};
    if (next.base.type) base.type = next.base.type;
    if (next.base.path) base.path = next.base.path;
    if (next.base.ref) base.ref = next.base.ref;
    if (next.base.def) base.def = next.base.def;
    if (!base.type && !base.path && !base.ref && !base.def) base = undefined;
  }

  if (!base && additional.length === 0) return null;
  return {
    ...(base ? { base: base as AgentFileBase } : {}),
    ...(additional.length > 0 ? { additional: additional as AgentSnippet[] } : {}),
  } as AgentFileConfig;
}

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

function BaseDialog({
  open,
  projectId,
  initial,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  projectId: string;
  initial: AgentFileConfig['base'];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (base: AgentFileConfig['base']) => Promise<void>;
}) {
  const { t } = useTranslation('projects');
  const [sourceMode, setSourceMode] = useState<'inline' | 'local'>('local');
  const [content, setContent] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceMode(initial?.path || initial?.type === 'local' ? 'local' : 'local');
    setPath(initial?.path || '');
    setContent('');
    setError(null);
  }, [open, initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (sourceMode === 'inline') {
        if (!content.trim()) {
          setError(t('agents.baseContentRequired'));
          setPending(false);
          return;
        }
        const file = new File([content.trim() + '\n'], 'agents-base.md', { type: 'text/markdown' });
        const uploaded = await projectsApi.uploadFs(projectId, file);
        await onSave({ type: 'local', path: uploaded.path, ref: null, def: null });
      } else {
        if (!path.trim()) {
          setError(t('agents.basePathRequired'));
          setPending(false);
          return;
        }
        await onSave({ type: 'local', path: path.trim(), ref: null, def: null });
      }
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 w-[min(520px,92vw)] rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">{t('agents.editBase')}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-text-tertiary">{t('agents.baseHint')}</p>
          {error && <p className="mb-3 text-xs text-error-text">{error}</p>}
          <div className="mb-3 flex flex-wrap gap-2">
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
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {sourceMode === 'local' ? (
              <div className="block text-xs text-text-secondary">
                {t('agents.basePath')}
                <div className="mt-1">
                  <LocalPathPicker
                    projectId={projectId}
                    value={path}
                    onChange={setPath}
                    ext="md"
                    placeholder={t('agents.basePathHint')}
                  />
                </div>
              </div>
            ) : (
              <label className="block text-xs text-text-secondary">
                {t('actions.content')}
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary"
                />
                <p className="mt-1 text-[11px] text-text-tertiary">{t('agents.inlineBaseHint')}</p>
              </label>
            )}
            <button
              type="submit"
              disabled={busy || pending}
              className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {(busy || pending) && <Loader2 size={14} className="animate-spin" />}
              {t('actions.save')}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SnippetDialog({
  open,
  mode,
  initial,
  projectId,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  initial: AgentSnippet | null;
  projectId: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: AgentSnippet, previous: AgentSnippet | null) => Promise<void>;
}) {
  const { t } = useTranslation('projects');
  const [sourceMode, setSourceMode] = useState<'inline' | 'local'>('inline');
  const [id, setId] = useState('');
  const [content, setContent] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSourceMode(initial.type === 'local' ? 'local' : 'inline');
      setId(initial.id || '');
      setContent(initial.content || '');
      setPath(initial.path || '');
    } else {
      setSourceMode('inline');
      setId('');
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
    if (sourceMode === 'local') {
      if (!path.trim()) {
        setError(t('agents.snippetPathRequired'));
        return;
      }
    } else if (!content.trim()) {
      setError(t('agents.snippetContentRequired'));
      return;
    }

    const entry: AgentSnippet =
      sourceMode === 'local'
        ? {
            id: id.trim(),
            type: 'local',
            content: null,
            url: null,
            path: path.trim(),
            def: null,
          }
        : {
            id: id.trim(),
            type: 'inline',
            content: content.trim(),
            url: null,
            path: null,
            def: null,
          };

    setPending(true);
    try {
      await onSave(entry, mode === 'edit' ? initial : null);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 w-[min(520px,92vw)] rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {mode === 'edit' ? t('agents.editSnippet') : t('agents.addSnippet')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {error && <p className="mb-3 text-xs text-error-text">{error}</p>}
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
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs text-text-secondary">
              ID
              <input
                value={id}
                disabled={mode === 'edit'}
                onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary disabled:opacity-60"
              />
            </label>
            {sourceMode === 'local' ? (
              <div className="block text-xs text-text-secondary">
                {t('agents.snippetPath')}
                <div className="mt-1">
                  <LocalPathPicker
                    projectId={projectId}
                    value={path}
                    onChange={setPath}
                    ext="md"
                    placeholder={t('agents.snippetPathHint')}
                  />
                </div>
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
              disabled={busy || pending}
              className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {(busy || pending) && <Loader2 size={14} className="animate-spin" />}
              {mode === 'edit' ? t('actions.save') : t('actions.add')}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
