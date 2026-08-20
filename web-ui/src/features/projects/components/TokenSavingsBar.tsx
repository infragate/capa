import { useTranslation } from 'react-i18next';
import { Loader2, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TokenSavingsResult } from './tokenStats';
import { formatTokenCount } from '../../../lib/utils';

interface TokenSavingsBarProps {
  stats: TokenSavingsResult | null;
  loading?: boolean;
}

function StatValue({
  loading,
  children,
  title,
}: {
  loading: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="text-center" title={loading ? undefined : title}>
      <div className="flex h-5 items-center justify-center text-sm font-medium text-text-primary">
        {loading ? (
          <Loader2 size={14} className="animate-spin text-accent-primary" aria-hidden />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function TokenSavingsBar({ stats, loading = false }: TokenSavingsBarProps) {
  const { t } = useTranslation('projects');
  const initialLoad = loading && !stats;
  const fmtSaved = stats ? formatTokenCount(stats.tokensSaved) : '—';
  const fmtWithout = stats ? formatTokenCount(stats.tokensWithout) : '—';
  const fmtWith = stats ? formatTokenCount(stats.tokensWith) : '—';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-sm border border-border-secondary bg-bg-tertiary px-4 py-3 text-xs text-text-secondary">
      <TrendingUp className="h-4 w-4 flex-shrink-0 text-accent-primary" />
      <span>{t('tokenSavings.label')}</span>
      <div className="flex items-center gap-3">
        <div className="min-w-[3.5rem]">
          <StatValue
            loading={initialLoad}
            title={`without capa ~${fmtWithout}, with capa ~${fmtWith}, saved ~${fmtSaved}`}
          >
            ~{fmtSaved}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.saved')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div className="min-w-[2.5rem]">
          <StatValue
            loading={initialLoad}
            title={stats ? `${stats.reduction.toFixed(1)}% reduction` : undefined}
          >
            {stats ? `${stats.reduction.toFixed(0)}%` : '—'}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.reduction')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div className="min-w-[2.5rem]">
          <StatValue
            loading={initialLoad}
            title={stats ? `${stats.overhead.toFixed(1)}% overhead` : undefined}
          >
            {stats ? `${stats.overhead.toFixed(0)}%` : '—'}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.overhead')}</div>
        </div>
      </div>
    </div>
  );
}
