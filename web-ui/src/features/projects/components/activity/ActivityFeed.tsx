import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { ActivityRow } from './ActivityRow';

interface ActivityFeedProps {
  calls: ToolCallRecord[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function ActivityFeed({
  calls,
  hasMore,
  loadingMore,
  onLoadMore,
}: ActivityFeedProps) {
  const { t } = useTranslation('projects');

  if (calls.length === 0) {
    return (
      <div className="rounded-sm border border-border-secondary bg-bg-secondary px-4 py-8 text-center text-sm text-text-tertiary">
        {t('activity.empty')}
      </div>
    );
  }

  return (
    <div className="max-h-[520px] overflow-y-auto rounded-sm border border-border-secondary bg-bg-secondary">
      {calls.map((call) => (
        <ActivityRow key={call.id} call={call} />
      ))}
      {hasMore && (
        <div className="sticky bottom-0 border-t border-border-tertiary bg-bg-secondary px-3 py-2.5 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border-primary bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover-bg cursor-pointer disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            {t('activity.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
