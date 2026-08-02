import { useTranslation } from 'react-i18next';
import type { ActivityStats } from '../../../../types/api';
import { cn } from '../../../../lib/utils';

interface ActivityStatsProps {
  stats: ActivityStats | null;
  live: boolean;
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span
        className={cn(
          'text-[13px] font-medium tabular-nums',
          warn ? 'text-error-text' : 'text-text-primary',
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-text-tertiary">{label}</span>
    </div>
  );
}

export function ActivityStatsBar({ stats, live }: ActivityStatsProps) {
  const { t } = useTranslation('projects');
  const avg =
    stats?.avg_duration_ms != null ? `${stats.avg_duration_ms}ms` : '—';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 rounded-full',
            live ? 'bg-status-connected-dot animate-pulse' : 'bg-text-tertiary',
          )}
          aria-hidden
        />
        <span className="text-[11px] text-text-tertiary">
          {live ? t('activity.live') : t('activity.offline')}
        </span>
      </div>
      <Stat label={t('activity.calls')} value={stats ? String(stats.total) : '—'} />
      <Stat
        label={t('activity.errors')}
        value={stats ? String(stats.errors) : '—'}
        warn={!!stats && stats.errors > 0}
      />
      <Stat label={t('activity.avgDuration')} value={avg} />
    </div>
  );
}
