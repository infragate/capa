import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X, Info } from 'lucide-react';
import { errMessage } from '../../../lib/errors';
import { useEditRegistry, usePreviewRegistry } from '../hooks';
import type { RegistryAdminRecord, RegistrySourceType } from '../api';
import { RegistryDialogFooter } from './RegistryDialogFooter';
import {
  RegistryPreviewPanel,
  type RegistryPreviewData,
} from './RegistryPreviewPanel';

interface EditRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: RegistryAdminRecord | null;
  onSaved: (slug: string) => void;
}

const TYPE_OPTIONS: RegistrySourceType[] = [
  'github',
  'gitlab',
  'url',
  'claude-marketplace',
];

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
  const [preview, setPreview] = useState<RegistryPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewRegistry();
  const editMutation = useEditRegistry();
  const busy = previewMutation.isPending || editMutation.isPending;

  const isMarketplace = type === 'claude-marketplace';

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
  const canSave =
    !busy &&
    trimmedSource.length > 0 &&
    (!changed || (preview && (isMarketplace || trusted)));

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
      setError(errMessage(err, 'Preview failed'));
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
      setError(
        t(
          isMarketplace
            ? 'addDialog.errors.previewBeforeAddMarketplace'
            : 'addDialog.errors.previewBeforeAdd',
        ),
      );
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
      setError(errMessage(err, 'Save failed'));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[90vh] w-[min(90vw,720px)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
          <div className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-medium text-text-primary">
                {t('editDialog.title', { slug: record.slug })}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">
                {t(
                  isMarketplace
                    ? 'editDialog.descriptionMarketplace'
                    : 'editDialog.description',
                )}
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
                  onChange={(e) => {
                    setType(e.target.value as RegistrySourceType);
                    setPreview(null);
                    setTrusted(false);
                  }}
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

              {isMarketplace && (
                <div className="flex items-start gap-2 rounded-sm border border-info-border bg-info-bg px-3 py-2 text-xs text-info-text">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{t('addDialog.marketplaceHint')}</span>
                </div>
              )}

              <RegistryPreviewPanel
                isMarketplace={isMarketplace}
                preview={preview}
                busy={busy}
                previewPending={previewMutation.isPending}
                canPreview={!!trimmedSource}
                onPreview={handlePreview}
              />

              {error && (
                <div className="rounded-sm border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                  {error}
                </div>
              )}
            </div>
          </div>

          <RegistryDialogFooter
            left={
              isMarketplace ? (
                <span className="text-xs text-text-secondary">
                  {preview && changed
                    ? t('addDialog.marketplaceReady')
                    : t('addDialog.marketplaceHint')}
                </span>
              ) : (
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
              )
            }
            onSubmit={handleSave}
            submitDisabled={!canSave}
            submitPending={editMutation.isPending}
            submitLabel={t('editDialog.submit')}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
