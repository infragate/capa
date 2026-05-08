import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { TokenSavingsResult } from './tokenStats';
import { formatTokenCount } from '../../../lib/utils';

interface TokenSavingsBarProps {
  stats: TokenSavingsResult;
}

export function TokenSavingsBar({ stats }: TokenSavingsBarProps) {
  const { t } = useTranslation('projects');
  const fmtSaved = formatTokenCount(stats.tokensSaved);
  const fmtWithout = formatTokenCount(stats.tokensWithout);
  const fmtWith = formatTokenCount(stats.tokensWith);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-sm border border-border-secondary bg-bg-tertiary px-4 py-3 text-xs text-text-secondary">
      <TrendingUp className="h-4 w-4 flex-shrink-0 text-accent-primary" />
      <span>{t('tokenSavings.label')}</span>
      <div className="flex items-center gap-3">
        <div className="text-center" title={`without capa ~${fmtWithout}, with capa ~${fmtWith}, saved ~${fmtSaved}`}>
          <div className="text-sm font-medium text-text-primary">~{fmtSaved}</div>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.saved')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div className="text-center" title={`${stats.reduction.toFixed(1)}% reduction`}>
          <div className="text-sm font-medium text-text-primary">{stats.reduction.toFixed(0)}%</div>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.reduction')}</div>
        </div>
        <div className="h-6 w-px bg-border-tertiary" />
        <div className="text-center" title={`${stats.overhead.toFixed(1)}% overhead`}>
          <div className="text-sm font-medium text-text-primary">{stats.overhead.toFixed(0)}%</div>
          <div className="text-[10px] text-text-tertiary">{t('tokenSavings.overhead')}</div>
        </div>
      </div>
      <span className="text-[11px] text-text-tertiary">
        {t('tokenSavings.toolCounts', {
          count: stats.serverCount,
          proxied: stats.proxiedCount,
          total: stats.totalServerTools,
          serverCount: stats.serverCount,
        })}
      </span>
    </div>
  );
}
