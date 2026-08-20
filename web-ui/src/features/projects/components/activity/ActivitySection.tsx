import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity as ActivityIcon, Search } from 'lucide-react';
import { Spinner } from '../../../../components/common/Spinner';
import { Alert } from '../../../../components/common/Alert';
import { useProjectActivity, useProject } from '../../hooks';
import { ActivityChart } from './ActivityChart';
import { ActivityFeed } from './ActivityFeed';
import { ActivityStatsBar } from './ActivityStats';
import { ActivityTracesDialog, type ActivityTracesView } from './ActivitySessionDialog';
import { filterActivityCalls } from './filterActivityCalls';

interface ActivitySectionProps {
  projectId: string;
}

export function ActivitySection({ projectId }: ActivitySectionProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');
  const [tracesView, setTracesView] = useState<ActivityTracesView | null>(null);
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
  const { data: project } = useProject(projectId);

  const filteredCalls = useMemo(
    () => filterActivityCalls(calls, search),
    [calls, search],
  );
  const searchActive = search.trim().length > 0;

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

      <div className="border-b border-border-secondary px-5 py-3">
        <div className="relative max-w-md">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('activity.searchPlaceholder')}
            className="w-full rounded-md border border-border-secondary bg-bg-secondary py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:outline-none"
          />
        </div>
        {searchActive ? (
          <p className="mt-2 text-[11px] text-text-tertiary">
            {t('activity.searchMatchCount', {
              matched: filteredCalls.length,
              total: calls.length,
            })}
          </p>
        ) : null}
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
          calls={filteredCalls}
          hasMore={hasMore && !searchActive}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          live={live}
          projectPath={project?.path ?? null}
          onViewConversation={(conversationId) =>
            setTracesView({ kind: 'conversation', id: conversationId })
          }
        />
      )}

      <ActivityTracesDialog
        projectId={projectId}
        view={tracesView}
        open={tracesView != null}
        onOpenChange={(open) => {
          if (!open) setTracesView(null);
        }}
        projectPath={project?.path ?? null}
      />
    </div>
  );
}
