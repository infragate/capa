import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCallRecord } from '../../../../types/api';
import { ActivitySpanRow } from './ActivitySpanRow';

type ActivityRunDialogTimelineProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  displayEvents: ToolCallRecord[];
  searchActive: boolean;
  timeline: { start: number; end: number };
  freshIds: Set<string>;
  fileLinkedSpanIds: Set<string>;
  onInspect: () => void;
  onExpandedChange: (nextOpen: boolean, call: ToolCallRecord) => void;
};

export function ActivityRunDialogTimeline({
  scrollRef,
  bottomRef,
  onScroll,
  displayEvents,
  searchActive,
  timeline,
  freshIds,
  fileLinkedSpanIds,
  onInspect,
  onExpandedChange,
}: ActivityRunDialogTimelineProps) {
  const { t } = useTranslation('projects');

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 h-full overflow-y-auto">
      <div className="sticky top-0 z-[1] flex items-center gap-2.5 border-b border-border-secondary bg-bg-secondary/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-text-tertiary backdrop-blur-sm">
        <span className="w-4 shrink-0" />
        <span className="min-w-0 flex-1">{t('activity.colName')}</span>
        <span className="hidden md:inline w-32 shrink-0 text-center">
          {t('activity.colTimeline')}
        </span>
        <span className="w-12 shrink-0 text-right">{t('activity.colLatency')}</span>
        <span className="w-[4.75rem] shrink-0 text-right">{t('activity.colTime')}</span>
      </div>
      {displayEvents.length === 0 && searchActive ? (
        <p className="px-4 py-8 text-center text-sm text-text-tertiary">
          {t('activity.runSearchNoResults')}
        </p>
      ) : (
        displayEvents.map((ev) => (
          <ActivitySpanRow
            key={ev.id}
            call={ev}
            runStart={timeline.start}
            runEnd={timeline.end}
            nestedPayload
            fresh={freshIds.has(ev.id)}
            fileLinked={fileLinkedSpanIds.has(ev.id)}
            onInspect={onInspect}
            onExpandedChange={onExpandedChange}
          />
        ))
      )}
      <div ref={bottomRef} className="h-2" aria-hidden />
    </div>
  );
}
