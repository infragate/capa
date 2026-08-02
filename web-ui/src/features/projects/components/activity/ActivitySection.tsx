import { useTranslation } from 'react-i18next';
import { Activity as ActivityIcon } from 'lucide-react';
import { Spinner } from '../../../../components/common/Spinner';
import { Alert } from '../../../../components/common/Alert';
import { useProjectActivity } from '../../hooks';
import { ActivityChart } from './ActivityChart';
import { ActivityFeed } from './ActivityFeed';
import { ActivityStatsBar } from './ActivityStats';

interface ActivitySectionProps {
  projectId: string;
}

export function ActivitySection({ projectId }: ActivitySectionProps) {
  const { t } = useTranslation('projects');
  const {
    calls,
    stats,
    isLoading,
    error,
    live,
    hasMore,
    loadingMore,
    loadMore,
  } = useProjectActivity(projectId);

  return (
    <div
      id="activity-section"
      className="mb-6 overflow-hidden rounded-lg border border-border-primary bg-bg-secondary"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-secondary px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-medium text-text-primary">
            <ActivityIcon size={16} className="text-text-tertiary" strokeWidth={1.75} />
            {t('activity.heading')}
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">{t('activity.subtitle')}</p>
        </div>
        <ActivityStatsBar stats={stats} live={live} />
      </div>

      <div className="border-b border-border-secondary px-5 py-3">
        <ActivityChart buckets={stats?.buckets} />
      </div>

      {isLoading ? (
        <div className="px-5 py-8">
          <Spinner label={t('activity.loading')} />
        </div>
      ) : error ? (
        <div className="px-5 py-4">
          <Alert type="error">{(error as Error).message}</Alert>
        </div>
      ) : (
        <ActivityFeed
          calls={calls}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          live={live}
        />
      )}
    </div>
  );
}
