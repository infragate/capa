import { useTranslation } from 'react-i18next';
import type { ActivityStats } from '../../../../types/api';
import { cn } from '../../../../lib/utils';

interface ActivityStatsProps {
  stats: ActivityStats | null;
  live: boolean;
}

function Tile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-[4.5rem] text-center', className)}>
      <div className="text-sm font-medium text-text-primary tabular-nums">{value}</div>
      <div className="text-[10px] text-text-tertiary">{label}</div>
    </div>
  );
}

export function ActivityStatsBar({ stats, live }: ActivityStatsProps) {
  const { t } = useTranslation('projects');

  const avg =
    stats?.avg_duration_ms != null ? `${stats.avg_duration_ms}ms` : '—';

  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-sm border border-border-secondary bg-bg-tertiary px-4 py-3 text-xs text-text-secondary">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            live ? 'bg-status-connected-dot animate-pulse' : 'bg-text-tertiary',
          )}
          aria-hidden
        />
        <span className="text-text-tertiary">
          {live ? t('activity.live') : t('activity.offline')}
        </span>
      </div>
      <div className="h-6 w-px bg-border-tertiary" />
      <Tile label={t('activity.calls')} value={stats ? String(stats.total) : '—'} />
      <div className="h-6 w-px bg-border-tertiary" />
      <Tile label={t('activity.errors')} value={stats ? String(stats.errors) : '—'} />
      <div className="h-6 w-px bg-border-tertiary" />
      <Tile label={t('activity.avgDuration')} value={avg} />
      <div className="h-6 w-px bg-border-tertiary" />
      <Tile
        label={t('activity.shellVsMcp')}
        value={stats ? `${stats.shell} / ${stats.mcp}` : '—'}
      />
    </div>
  );
}
