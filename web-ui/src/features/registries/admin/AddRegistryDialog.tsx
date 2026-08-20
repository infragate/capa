import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X, Info } from 'lucide-react';
import { errMessage } from '../../../lib/errors';
import { useAddRegistry, usePreviewRegistry } from '../hooks';
import type { RegistrySourceType } from '../api';
import { RegistryDialogFooter } from './RegistryDialogFooter';
import {
  RegistryPreviewPanel,
  type RegistryPreviewData,
} from './RegistryPreviewPanel';

interface AddRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (slug: string) => void;
}

type AddMode = 'adapter' | 'claude-marketplace';

const ADAPTER_TYPE_OPTIONS: RegistrySourceType[] = ['github', 'gitlab', 'url'];

export function AddRegistryDialog({ open, onOpenChange, onAdded }: AddRegistryDialogProps) {
  const { t } = useTranslation('registries');
  const [mode, setMode] = useState<AddMode>('adapter');
  const [type, setType] = useState<RegistrySourceType>('github');
  const [source, setSource] = useState('');
  const [slug, setSlug] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [preview, setPreview] = useState<RegistryPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewRegistry();
  const addMutation = useAddRegistry();
  const busy = previewMutation.isPending || addMutation.isPending;

  const effectiveType: RegistrySourceType =
    mode === 'claude-marketplace' ? 'claude-marketplace' : type;
  const isMarketplace = mode === 'claude-marketplace';

  // Reset state whenever the dialog re-opens so a previously-failed attempt
  // doesn't leak into a fresh one.
  useEffect(() => {
    if (open) {
      setMode('adapter');
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

  // Clearing preview when the mode/type/source changes avoids installing a
  // previously-audited payload against a different source.
  useEffect(() => {
    setPreview(null);
    setTrusted(false);
  }, [mode, type, source]);

  const canAdd = isMarketplace
    ? !!preview && !!source.trim() && !busy
    : !!preview && trusted && !!source.trim() && !busy;

  async function handlePreview() {
    setError(null);
    setPreview(null);
    if (!source.trim()) {
      setError(t('addDialog.errors.missingSource'));
      return;
    }
    try {
      const res = await previewMutation.mutateAsync({
        type: effectiveType,
        source: source.trim(),
      });
      setPreview({
        content: res.content,
        ref: res.resolvedRef,
        pluginCount: res.pluginCount,
      });
      if (!slug && res.derivedSlug) {
        setSlug(res.derivedSlug);
      }
    } catch (err) {
      setError(errMessage(err, 'Preview failed'));
    }
  }

  async function handleAdd() {
    setError(null);
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
      const res = await addMutation.mutateAsync({
        type: effectiveType,
        source: source.trim(),
        slug: slug.trim() || undefined,
      });
      onAdded(res.registry.slug);
    } catch (err) {
      setError(errMessage(err, 'Add failed'));
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
                {t('addDialog.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">
                {t(isMarketplace ? 'addDialog.descriptionMarketplace' : 'addDialog.description')}
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
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-text-secondary">
                  {t('addDialog.fields.mode')}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(['adapter', 'claude-marketplace'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={
                        mode === m
                          ? 'rounded-sm border border-accent-primary bg-accent-primary/10 px-3 py-1.5 text-sm text-text-primary'
                          : 'rounded-sm border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-secondary hover:bg-hover-bg'
                      }
                    >
                      {t(`addDialog.modes.${m}`)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {isMarketplace && (
                <div className="flex items-start gap-2 rounded-sm border border-info-border bg-info-bg px-3 py-2 text-xs text-info-text">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{t('addDialog.marketplaceHint')}</span>
                </div>
              )}

              {!isMarketplace && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-secondary">
                    {t('addDialog.fields.type')}
                  </span>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as RegistrySourceType)}
                    className="w-full rounded-sm border border-border-primary bg-bg-primary px-2 py-2 text-sm text-text-primary"
                  >
                    {ADAPTER_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {t(`addDialog.typeOptions.${opt}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">
                  {t('addDialog.fields.source')}
                </span>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t(
                    isMarketplace
                      ? 'addDialog.sourcePlaceholders.claude-marketplace'
                      : `addDialog.sourcePlaceholders.${type}`,
                  )}
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

              <RegistryPreviewPanel
                isMarketplace={isMarketplace}
                preview={preview}
                busy={busy}
                previewPending={previewMutation.isPending}
                canPreview={!!source.trim()}
                onPreview={handlePreview}
                showPluginCount
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
                  {preview
                    ? t('addDialog.marketplaceReady')
                    : t('addDialog.marketplaceHint')}
                </span>
              ) : (
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
              )
            }
            onSubmit={handleAdd}
            submitDisabled={!canAdd}
            submitPending={addMutation.isPending}
            submitLabel={t('addDialog.submit')}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
