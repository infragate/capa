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
  const fmtSaved = stats ? formatTokenCount(stats.tokensSaved) : '—';
  const fmtWithout = stats ? formatTokenCount(stats.tokensWithout) : '—';
  const fmtWith = stats ? formatTokenCount(stats.tokensWith) : '—';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-sm border border-border-secondary bg-bg-tertiary px-4 py-3 text-xs text-text-secondary">
      <TrendingUp className="h-4 w-4 flex-shrink-0 text-accent-primary" />
      <span>{t('tokenSavings.label')}</span>
      <div className="flex items-center gap-3">
        <div>
          <StatValue
            loading={loading}
            title={`without capa ~${fmtWithout}, with capa ~${fmtWith}, saved ~${fmtSaved}`}
          >
            ~{fmtSaved}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.saved')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div>
          <StatValue
            loading={loading}
            title={stats ? `${stats.reduction.toFixed(1)}% reduction` : undefined}
          >
            {stats ? `${stats.reduction.toFixed(0)}%` : '—'}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.reduction')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div>
          <StatValue
            loading={loading}
            title={stats ? `${stats.overhead.toFixed(1)}% overhead` : undefined}
          >
            {stats ? `${stats.overhead.toFixed(0)}%` : '—'}
          </StatValue>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.overhead')}</div>
        </div>
      </div>
      <span className="min-h-[1.25rem] text-[11px] text-text-tertiary">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-accent-primary" aria-hidden />
            <span className="sr-only">{t('status.loading', { ns: 'common' })}</span>
          </span>
        ) : stats ? (
          t('tokenSavings.toolCounts', {
            count: stats.serverCount,
            proxied: stats.proxiedCount,
            total: stats.totalServerTools,
            serverCount: stats.serverCount,
          })
        ) : null}
      </span>
    </div>
  );
}
