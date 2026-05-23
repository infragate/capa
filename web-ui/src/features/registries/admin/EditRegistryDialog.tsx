import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X, Eye, AlertTriangle, Loader2 } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useEditRegistry, usePreviewRegistry } from '../hooks';
import type { RegistryAdminRecord, RegistrySourceType } from '../api';
import { CodeBlock } from '../../../components/common/CodeBlock';

interface EditRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: RegistryAdminRecord | null;
  onSaved: (slug: string) => void;
}

const TYPE_OPTIONS: RegistrySourceType[] = ['github', 'gitlab', 'url'];

function isErrorWithMessage(err: unknown): err is { message: string } {
  return !!err && typeof (err as any).message === 'string';
}

export function EditRegistryDialog({
  open,
  onOpenChange,
  record,
  onSaved,
}: EditRegistryDialogProps) {
  const { t } = useTranslation('registries');
  const [type, setType] = useState<RegistrySourceType>('github');
  const [source, setSource] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [preview, setPreview] = useState<{ content: string; ref: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewRegistry();
  const editMutation = useEditRegistry();
  const busy = previewMutation.isPending || editMutation.isPending;

  // Re-seed the form whenever a different record is opened or the dialog
  // toggles open — so a previously-failed attempt doesn't leak into a
  // fresh edit session.
  useEffect(() => {
    if (open && record) {
      setType(record.type);
      setSource(record.source);
      setTrusted(false);
      setPreview(null);
      setError(null);
      previewMutation.reset();
      editMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.slug]);

  if (!record) return null;

  const trimmedSource = source.trim();
  const changed = type !== record.type || trimmedSource !== record.source;
  // Same security gate as the Add dialog: a fresh preview + trust check is
  // required before persisting *new* code under a known slug.
  const canSave = !busy && trimmedSource.length > 0 && (!changed || (preview && trusted));

  async function handlePreview() {
    setError(null);
    setPreview(null);
    if (!trimmedSource) {
      setError(t('addDialog.errors.missingSource'));
      return;
    }
    try {
      const res = await previewMutation.mutateAsync({ type, source: trimmedSource });
      setPreview({ content: res.content, ref: res.resolvedRef });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isErrorWithMessage(err)
            ? err.message
            : 'Preview failed',
      );
    }
  }

  async function handleSave() {
    setError(null);
    if (!record) return;
    if (!changed) {
      onOpenChange(false);
      return;
    }
    if (!preview) {
      setError(t('addDialog.errors.previewBeforeAdd'));
      return;
    }
    try {
      const res = await editMutation.mutateAsync({
        slug: record.slug,
        type,
        source: trimmedSource,
      });
      onSaved(res.registry.slug);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isErrorWithMessage(err)
            ? err.message
            : 'Save failed',
      );
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
                {t('editDialog.title', { slug: record.slug })}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">
                {t('editDialog.description')}
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
                  {t('addDialog.fields.slug')}
                </span>
                <input
                  type="text"
                  value={record.slug}
                  disabled
                  className="w-full rounded-sm border border-border-secondary bg-bg-tertiary px-2 py-2 font-mono text-sm text-text-secondary"
                />
                <span className="mt-1 block text-xs text-text-tertiary">
                  {t('editDialog.slugImmutable')}
                </span>
              </label>

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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={busy || !trimmedSource}
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
                changed && preview
                  ? 'flex items-center gap-2 text-sm text-text-primary'
                  : 'flex items-center gap-2 text-sm text-text-tertiary'
              }
              title={
                !changed
                  ? t('editDialog.noChanges')
                  : !preview
                    ? t('addDialog.errors.previewBeforeAdd')
                    : undefined
              }
            >
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
                disabled={!preview || !changed}
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
                onClick={handleSave}
                disabled={!canSave}
                className="inline-flex items-center gap-2 rounded-sm border border-accent-primary bg-accent-primary px-3 py-1.5 text-sm font-medium text-bg-secondary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{t('editDialog.submit')}</span>
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
