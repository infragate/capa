import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X, Eye, AlertTriangle, Loader2 } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useAddRegistry, usePreviewRegistry } from '../hooks';
import type { RegistrySourceType } from '../api';
import { CodeBlock } from '../../../components/common/CodeBlock';

interface AddRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (slug: string) => void;
}

const TYPE_OPTIONS: RegistrySourceType[] = ['github', 'gitlab', 'url'];

function isErrorWithMessage(err: unknown): err is { message: string } {
  return !!err && typeof (err as any).message === 'string';
}

export function AddRegistryDialog({ open, onOpenChange, onAdded }: AddRegistryDialogProps) {
  const { t } = useTranslation('registries');
  const [type, setType] = useState<RegistrySourceType>('github');
  const [source, setSource] = useState('');
  const [slug, setSlug] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [preview, setPreview] = useState<{ content: string; ref: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewRegistry();
  const addMutation = useAddRegistry();
  const busy = previewMutation.isPending || addMutation.isPending;

  // Reset state whenever the dialog re-opens so a previously-failed attempt
  // doesn't leak into a fresh one.
  useEffect(() => {
    if (open) {
      setType('github');
      setSource('');
      setSlug('');
      setTrusted(false);
      setPreview(null);
      setError(null);
      previewMutation.reset();
      addMutation.reset();
    }
    // We intentionally only react to `open` here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canAdd = !!preview && trusted && !!source.trim() && !busy;

  async function handlePreview() {
    setError(null);
    setPreview(null);
    if (!source.trim()) {
      setError(t('addDialog.errors.missingSource'));
      return;
    }
    try {
      const res = await previewMutation.mutateAsync({ type, source: source.trim() });
      setPreview({ content: res.content, ref: res.resolvedRef });
      if (!slug && res.derivedSlug) {
        setSlug(res.derivedSlug);
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : isErrorWithMessage(err)
            ? err.message
            : 'Preview failed';
      setError(message);
    }
  }

  async function handleAdd() {
    setError(null);
    if (!preview) {
      setError(t('addDialog.errors.previewBeforeAdd'));
      return;
    }
    try {
      const res = await addMutation.mutateAsync({
        type,
        source: source.trim(),
        slug: slug.trim() || undefined,
      });
      onAdded(res.registry.slug);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : isErrorWithMessage(err)
            ? err.message
            : 'Add failed';
      setError(message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
          <div className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-medium text-text-primary">
                {t('addDialog.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">
                {t('addDialog.description')}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-hover-bg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">
                  {t('addDialog.fields.type')}
                </span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as RegistrySourceType)}
                  className="w-full rounded-sm border border-border-primary bg-bg-primary px-2 py-2 text-sm text-text-primary"
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(`addDialog.typeOptions.${opt}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">
                  {t('addDialog.fields.source')}
                </span>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t(`addDialog.sourcePlaceholders.${type}`)}
                  className="w-full rounded-sm border border-border-primary bg-bg-primary px-2 py-2 font-mono text-sm text-text-primary placeholder:text-text-tertiary"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">
                  {t('addDialog.fields.slug')}
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={t('addDialog.fields.slugHint')}
                  className="w-full rounded-sm border border-border-primary bg-bg-primary px-2 py-2 font-mono text-sm text-text-primary placeholder:text-text-tertiary"
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={busy || !source.trim()}
                  className="inline-flex items-center gap-2 rounded-sm border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  <span>{t('addDialog.preview.button')}</span>
                </button>
                {preview?.ref && (
                  <span className="font-mono text-xs text-text-secondary">
                    {t('addDialog.preview.resolvedRef', { ref: preview.ref.slice(0, 7) })}
                  </span>
                )}
              </div>

              <div className="rounded-sm border border-border-primary bg-bg-primary">
                <div className="border-b border-border-secondary px-3 py-2 text-xs font-medium text-text-secondary">
                  {t('addDialog.preview.title')}
                </div>
                <div className="max-h-72 overflow-auto">
                  {preview ? (
                    <CodeBlock code={preview.content} language="typescript" />
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-6 text-xs text-text-tertiary">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>{t('addDialog.preview.emptyHint')}</span>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="rounded-sm border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-secondary px-6 py-4">
            <label
              className={
                preview
                  ? 'flex items-center gap-2 text-sm text-text-primary'
                  : 'flex items-center gap-2 text-sm text-text-tertiary'
              }
              title={preview ? undefined : t('addDialog.errors.previewBeforeAdd')}
            >
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
                disabled={!preview}
              />
              <span>{t('addDialog.trust')}</span>
            </label>
            <div className="flex items-center gap-2">
              <Dialog.Close
                type="button"
                className="rounded-sm border border-border-secondary bg-bg-tertiary px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-hover-bg"
              >
                {t('addDialog.cancel')}
              </Dialog.Close>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAdd}
                className="inline-flex items-center gap-2 rounded-sm border border-accent-primary bg-accent-primary px-3 py-1.5 text-sm font-medium text-bg-secondary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{t('addDialog.submit')}</span>
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
