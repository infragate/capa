import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import type { ActivityRun } from './groupActivityRuns';
import { formatClockTime, formatDuration, formatRelative } from './groupActivityRuns';
import { ActivitySpanRow } from './ActivitySpanRow';
import {
  type ConversationTimelineBlock,
  CONCURRENT_LANE_BORDER,
  concurrentGridClass,
  runEventsForTimeline,
  sessionIdForRun,
} from './conversationTimeline';

interface ActivityConversationTimelineProps {
  blocks: ConversationTimelineBlock[];
  runBoundsById: Map<string, { start: number; end: number }>;
  freshIds: ReadonlySet<string>;
  fileLinkedSpanIds: ReadonlySet<string>;
  onInspect: () => void;
  onSpanExpandedChange: (nextOpen: boolean, call: ToolCallRecord) => void;
}

function TurnHeader({
  run,
  concurrent,
  lane,
  t,
}: {
  run: ActivityRun;
  concurrent?: boolean;
  lane?: number;
  t: TFunction<'projects'>;
}) {
  const spanCount = runEventsForTimeline(run).length;
  const sessionId = sessionIdForRun(run);
  const laneBorder =
    concurrent && lane != null ? CONCURRENT_LANE_BORDER[lane % CONCURRENT_LANE_BORDER.length] : null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border-secondary/90 bg-bg-tertiary/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-text-tertiary',
        laneBorder && `border-l-2 ${laneBorder}`,
        concurrent && 'bg-bg-tertiary/70',
      )}
    >
      <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-[12px] text-text-secondary">
        {run.title}
      </span>
      {sessionId ? (
        <span
          className="hidden max-w-[5.5rem] shrink-0 truncate font-mono text-[9px] normal-case tracking-normal text-text-tertiary lg:inline"
          title={sessionId}
        >
          {sessionId.slice(-8)}
        </span>
      ) : null}
      <span className="shrink-0 tabular-nums normal-case tracking-normal">
        {spanCount} {spanCount === 1 ? t('activity.span') : t('activity.spans')}
      </span>
      <span className="shrink-0 tabular-nums">{formatDuration(run.duration_ms)}</span>
      <span className="hidden shrink-0 tabular-nums sm:inline">{formatRelative(run.started_at)}</span>
    </div>
  );
}

function TurnSpans({
  run,
  runBoundsById,
  freshIds,
  fileLinkedSpanIds,
  onInspect,
  onSpanExpandedChange,
}: {
  run: ActivityRun;
  runBoundsById: Map<string, { start: number; end: number }>;
  freshIds: ReadonlySet<string>;
  fileLinkedSpanIds: ReadonlySet<string>;
  onInspect: () => void;
  onSpanExpandedChange: ActivityConversationTimelineProps['onSpanExpandedChange'];
}) {
  const bounds = runBoundsById.get(run.id)!;
  return (
    <>
      {runEventsForTimeline(run).map((call) => (
        <ActivitySpanRow
          key={call.id}
          call={call}
          runStart={bounds.start}
          runEnd={bounds.end}
          nestedPayload
          fresh={freshIds.has(call.id)}
          fileLinked={fileLinkedSpanIds.has(call.id)}
          onInspect={onInspect}
          onExpandedChange={onSpanExpandedChange}
        />
      ))}
    </>
  );
}

export function ActivityConversationTimeline({
  blocks,
  runBoundsById,
  freshIds,
  fileLinkedSpanIds,
  onInspect,
  onSpanExpandedChange,
}: ActivityConversationTimelineProps) {
  const { t } = useTranslation('projects');

  return (
    <>
      {blocks.map((block) => {
        if (block.kind === 'single') {
          return (
            <div key={block.run.id}>
              <TurnHeader run={block.run} t={t} />
              <TurnSpans
                run={block.run}
                runBoundsById={runBoundsById}
                freshIds={freshIds}
                fileLinkedSpanIds={fileLinkedSpanIds}
                onInspect={onInspect}
                onSpanExpandedChange={onSpanExpandedChange}
              />
            </div>
          );
        }

        return (
          <div
            key={`concurrent-${block.runs.map((r) => r.id).join('|')}`}
            className="border-b border-border-secondary/90"
          >
            <div className="flex items-center gap-2 border-b border-accent-primary/20 bg-accent-primary/[0.06] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-accent-primary">
              <GitBranch size={12} className="shrink-0" aria-hidden />
              <span className="normal-case tracking-normal">
                {t('activity.concurrentTurns', { count: block.runs.length })}
              </span>
              <span className="ml-auto shrink-0 tabular-nums normal-case tracking-normal text-text-tertiary">
                {formatClockTime(block.started_at)}
                {' – '}
                {formatClockTime(block.ended_at)}
              </span>
            </div>
            <div
              className={cn(
                'grid divide-x divide-border-secondary/80',
                concurrentGridClass(block.runs.length),
              )}
            >
              {block.runs.map((run, lane) => (
                <div key={run.id} className="min-w-0">
                  <TurnHeader run={run} concurrent lane={lane} t={t} />
                  <TurnSpans
                    run={run}
                    runBoundsById={runBoundsById}
                    freshIds={freshIds}
                    fileLinkedSpanIds={fileLinkedSpanIds}
                    onInspect={onInspect}
                    onSpanExpandedChange={onSpanExpandedChange}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
