import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RegistryItemDetail } from '../../../registries/api';
import { Spinner } from '../../../../components/common/Spinner';
import { FileTree } from '../../../../components/common/FileTree';
import { renderMarkdown } from './markdown';
import type { ResultRow } from './types';

interface DetailPanelProps {
  selected: ResultRow | null;
  detail: RegistryItemDetail | null;
  detailLoading: boolean;
  busy: boolean;
  onAdd: () => void;
}

export function DetailPanel({ selected, detail, detailLoading, busy, onAdd }: DetailPanelProps) {
  const { t } = useTranslation('projects');

  const previewHtml = useMemo(
    () => (detail?.preview ? renderMarkdown(detail.preview) : ''),
    [detail?.preview],
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-sm border border-border-tertiary bg-bg-primary/30">
      {!selected && (
        <p className="m-auto px-4 py-8 text-center text-xs text-text-tertiary">
          {t('actions.selectItemPreview')}
        </p>
      )}
      {selected && detailLoading && <Spinner className="py-12" />}
      {selected && !detailLoading && detail && (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-border-secondary px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate font-mono text-sm font-medium text-text-primary">
                {detail.title || detail.id}
              </h3>
              {detail.description && (
                <p className="mt-1 text-xs text-text-secondary">{detail.description}</p>
              )}
              <p className="mt-1 text-[11px] text-text-tertiary">
                {selected.registryName}
                {detail.author ? ` · ${detail.author}` : ''}
                {detail.version ? ` · ${detail.version}` : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onAdd}
              className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('actions.add')}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {detail.files && detail.files.length > 0 && (
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-medium text-text-primary">
                  {t('skillDetail.files')}
                </h4>
                <FileTree files={detail.files} />
              </div>
            )}
            {previewHtml ? (
              <div
                className="registry-markdown overflow-hidden text-sm text-text-secondary"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <p className="text-xs text-text-tertiary">{t('actions.noPreview')}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
