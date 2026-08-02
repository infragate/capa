import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentFileConfig } from '../../../../types/api';
import { projectsApi } from '../../api';
import { LocalPathPicker } from '../LocalPathPicker';

interface BaseDialogProps {
  open: boolean;
  projectId: string;
  initial: AgentFileConfig['base'];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (base: AgentFileConfig['base']) => Promise<void>;
}

export function BaseDialog({
  open,
  projectId,
  initial,
  busy,
  onOpenChange,
  onSave,
}: BaseDialogProps) {
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
