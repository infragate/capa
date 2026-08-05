import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import { ActivityRunDialog } from './ActivityRunDialog';
import {
  type ActivityConversation,
  type ActivityRun,
  formatDuration,
  formatRelative,
  groupActivityConversations,
  maxSpanDuration,
  shortConversationLabel,
  sumRunTokenUsage,
} from './groupActivityRuns';
import { LatencyBar, sourceLabelText, TokenUsageLabel } from './ActivityShared';

interface ActivityFeedProps {
  calls: ToolCallRecord[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  live?: boolean;
  projectPath?: string | null;
}

function RunRow({
  run,
  maxMs,
  onOpen,
  nested,
}: {
  run: ActivityRun;
  maxMs: number;
  onOpen: () => void;
  nested?: boolean;
}) {
  const { t } = useTranslation('projects');
  const spanCount = run.spans.length + (run.prompt ? 1 : 0);
  const running = [run.prompt, ...run.spans].some((s) => s?.status === 'running');
  const tokenTotals = sumRunTokenUsage([
    ...(run.prompt ? [run.prompt] : []),
    ...run.spans,
  ]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-2 py-2.5 text-left cursor-pointer',
        nested ? 'pl-6 pr-3' : 'px-3',
        'border-b border-border-secondary/90 last:border-b-0',
        'hover:bg-hover-bg/60 transition-colors duration-100',
      )}
    >
      <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          running
            ? 'bg-accent-primary animate-pulse'
            : run.hasError
              ? 'bg-error-text'
              : 'bg-status-connected-dot',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
        {run.title}
      </span>
      {tokenTotals.hasAny ? (
        <TokenUsageLabel
          totals={tokenTotals}
          t={t}
          className="hidden max-w-[9rem] shrink-0 truncate text-[10px] lg:inline"
        />
      ) : null}
      <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
        {spanCount} {spanCount === 1 ? t('activity.span') : t('activity.spans')}
      </span>
      <LatencyBar ms={run.duration_ms} maxMs={maxMs} errored={run.hasError} />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
        {formatDuration(run.duration_ms)}
      </span>
      <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-text-tertiary sm:block">
        {formatRelative(run.started_at)}
      </span>
    </button>
  );
}

/** Height of the sticky column header row (`RunRow` aligns below this). */
const FEED_STICKY_COL_HEADER_CLASS = 'top-0';
const FEED_STICKY_SECTION_HEADER_CLASS = 'top-7';

function ConversationBlock({
  conversation,
  maxMs,
  onOpenRun,
}: {
  conversation: ActivityConversation;
  maxMs: number;
  onOpenRun: (id: string) => void;
}) {
  const { t } = useTranslation('projects');
  const multi = conversation.generations.length > 1;
  const isOrphan = conversation.id.startsWith('orphan:');
  const title = isOrphan
    ? t('activity.ungrouped', { defaultValue: 'Activity' })
    : t('activity.conversation', {
        defaultValue: 'Conversation {{id}}',
        id: shortConversationLabel(conversation.id),
      });

  return (
    <section>
      <div
        className={cn(
          'sticky z-[2]',
          FEED_STICKY_SECTION_HEADER_CLASS,
          'flex items-center gap-2 border-b border-border-secondary/90',
          'bg-bg-secondary/95 px-3 py-1.5 backdrop-blur-sm',
          'text-[10px] font-medium uppercase tracking-[0.06em] text-text-tertiary',
        )}
      >
        <span
          className="min-w-0 flex-1 truncate"
          title={isOrphan ? undefined : conversation.id}
        >
          {title}
        </span>
        {conversation.source ? (
          <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-secondary">
            {sourceLabelText(conversation.source, t)}
          </span>
        ) : null}
        <span className="shrink-0 tabular-nums">
          {conversation.generations.length}{' '}
          {conversation.generations.length === 1
            ? t('activity.generation', { defaultValue: 'turn' })
            : t('activity.generations', { defaultValue: 'turns' })}
        </span>
      </div>
      {conversation.generations.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          maxMs={maxMs}
          nested={multi}
          onOpen={() => onOpenRun(run.id)}
        />
      ))}
    </section>
  );
}

export function ActivityFeed({
  calls,
  hasMore,
  loadingMore,
  onLoadMore,
  live = false,
  projectPath = null,
}: ActivityFeedProps) {
  const { t } = useTranslation('projects');
  const conversations = useMemo(
    () => groupActivityConversations(calls),
    [calls],
  );
  const runs = useMemo(
    () => conversations.flatMap((c) => c.generations),
    [conversations],
  );
  const maxMs = useMemo(() => maxSpanDuration(runs), [runs]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => (selectedId ? runs.find((r) => r.id === selectedId) ?? null : null),
    [runs, selectedId],
  );

  if (calls.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-text-tertiary">
        {t('activity.empty')}
      </div>
    );
  }

  return (
    <>
      <div className="flex max-h-[560px] flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div
            className={cn(
              'sticky z-[3]',
              FEED_STICKY_COL_HEADER_CLASS,
              'flex items-center gap-2 border-b border-border-secondary bg-bg-secondary/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-text-tertiary backdrop-blur-sm',
            )}
          >
            <span className="w-4 shrink-0" />
            <span className="min-w-0 flex-1">{t('activity.colName')}</span>
            <span className="w-14 shrink-0 text-right">{t('activity.colSpans')}</span>
            <span className="hidden md:inline w-14 shrink-0" />
            <span className="w-12 shrink-0 text-right">{t('activity.colLatency')}</span>
            <span className="hidden w-14 shrink-0 text-right sm:block">
              {t('activity.colTime')}
            </span>
          </div>
          {conversations.map((conversation) => (
            <ConversationBlock
              key={conversation.id}
              conversation={conversation}
              maxMs={maxMs}
              onOpenRun={setSelectedId}
            />
          ))}
        </div>
        {hasMore ? (
          <div className="shrink-0 border-t border-border-secondary bg-bg-secondary px-3 py-2.5 text-center">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover-bg cursor-pointer disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={12} className="animate-spin" />}
              {t('activity.loadMore')}
            </button>
          </div>
        ) : null}
      </div>

      <ActivityRunDialog
        run={selectedRun}
        open={selectedId != null && selectedRun != null}
        onOpenChange={(next) => {
          if (!next) setSelectedId(null);
        }}
        live={live}
        projectPath={projectPath}
      />
    </>
  );
}
