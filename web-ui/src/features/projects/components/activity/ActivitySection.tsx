import { useTranslation } from 'react-i18next';
import { Activity as ActivityIcon, ListTree } from 'lucide-react';
import { Spinner } from '../../../../components/common/Spinner';
import { Alert } from '../../../../components/common/Alert';
import { useProjectActivity } from '../../hooks';
import { CapabilityCollapsible } from '../CapabilityCollapsible';
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
    <div id="activity-section" className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="flex items-center gap-2 text-base font-medium text-text-primary">
          <ActivityIcon size={18} />
          {t('activity.heading')}
        </h2>
        <p className="mt-1 text-xs text-text-tertiary">{t('activity.subtitle')}</p>
      </div>

      <ActivityStatsBar stats={stats} live={live} />
      <ActivityChart buckets={stats?.buckets} />

      {isLoading ? (
        <div className="py-4">
          <Spinner label={t('activity.loading')} />
        </div>
      ) : error ? (
        <Alert type="error">{(error as Error).message}</Alert>
      ) : (
        <CapabilityCollapsible
          title={t('activity.traces')}
          icon={ListTree}
          count={calls.length}
          defaultOpen={false}
        >
          <ActivityFeed
            calls={calls}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
          />
        </CapabilityCollapsible>
      )}
    </div>
  );
}
