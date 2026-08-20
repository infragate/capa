import { Eye, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '../../../components/common/CodeBlock';

export type RegistryPreviewData = {
  content: string;
  ref: string | null;
  pluginCount?: number;
};

interface RegistryPreviewPanelProps {
  isMarketplace: boolean;
  preview: RegistryPreviewData | null;
  busy: boolean;
  previewPending: boolean;
  canPreview: boolean;
  onPreview: () => void;
  /** Show marketplace plugin count badge (add dialog only). */
  showPluginCount?: boolean;
}

/** Shared preview button + resolved-ref + code panel for add/edit registry dialogs. */
export function RegistryPreviewPanel({
  isMarketplace,
  preview,
  busy,
  previewPending,
  canPreview,
  onPreview,
  showPluginCount = false,
}: RegistryPreviewPanelProps) {
  const { t } = useTranslation('registries');

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPreview}
          disabled={busy || !canPreview}
          className="inline-flex items-center gap-2 rounded-sm border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewPending ? (
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
        {showPluginCount && isMarketplace && preview?.pluginCount != null && (
          <span className="text-xs text-text-secondary">
            {t('addDialog.preview.pluginCount', { count: preview.pluginCount })}
          </span>
        )}
      </div>

      <div className="rounded-sm border border-border-primary bg-bg-primary">
        <div className="border-b border-border-secondary px-3 py-2 text-xs font-medium text-text-secondary">
          {t(
            isMarketplace
              ? 'addDialog.preview.titleMarketplace'
              : 'addDialog.preview.title',
          )}
        </div>
        <div className="max-h-72 overflow-auto">
          {preview ? (
            <CodeBlock
              code={preview.content}
              language={isMarketplace ? 'json' : 'typescript'}
            />
          ) : (
            <div className="flex items-center gap-2 px-3 py-6 text-xs text-text-tertiary">
              {isMarketplace ? (
                <Info className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              <span>
                {t(
                  isMarketplace
                    ? 'addDialog.preview.emptyHintMarketplace'
                    : 'addDialog.preview.emptyHint',
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
