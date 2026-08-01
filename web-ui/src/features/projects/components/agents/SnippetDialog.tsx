import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentSnippet } from '../../../../types/api';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../../lib/ids';
import { LocalPathPicker } from '../LocalPathPicker';

interface SnippetDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  initial: AgentSnippet | null;
  projectId: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: AgentSnippet, previous: AgentSnippet | null) => Promise<void>;
}

export function SnippetDialog({
  open,
  mode,
  initial,
  projectId,
  busy,
  onOpenChange,
  onSave,
}: SnippetDialogProps) {
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
                onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
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
