import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, Pause, X } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import {
  type ActivityRun,
  formatDuration,
  formatRelative,
  sumRunTokenUsage,
} from './groupActivityRuns';
import { ActivitySpanRow } from './ActivitySpanRow';
import { sourceLabelText, TokenUsageLabel } from './ActivityShared';

interface ActivityRunDialogProps {
  run: ActivityRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  live?: boolean;
}

function runEvents(run: ActivityRun): ToolCallRecord[] {
  return [...(run.prompt ? [run.prompt] : []), ...run.spans];
}

function runErrorCount(run: ActivityRun): number {
  return runEvents(run).filter((e) => e.status === 'error').length;
}

function runIsLive(run: ActivityRun): boolean {
  return runEvents(run).some((e) => e.status === 'running');
}

/** Absolute [start, end] of the run timeline for Gantt positioning. */
function runTimelineBounds(run: ActivityRun, events: ToolCallRecord[]): {
  start: number;
  end: number;
} {
  const start = run.started_at;
  let end = start + (run.duration_ms ?? 0);
  const now = Date.now();
  for (const e of events) {
    const spanEnd =
      e.duration_ms != null
        ? e.started_at + e.duration_ms
        : e.status === 'running'
          ? Math.max(e.started_at, now)
          : e.started_at;
    end = Math.max(end, spanEnd);
  }
  if (runIsLive(run)) end = Math.max(end, now);
  return { start, end: Math.max(end, start + 1) };
}

export function ActivityRunDialog({
  run,
  open,
  onOpenChange,
  live = false,
}: ActivityRunDialogProps) {
  const { t } = useTranslation('projects');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const eventCount = run ? runEvents(run).length : 0;
  const prevCountRef = useRef(eventCount);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const events = useMemo(() => (run ? runEvents(run) : []), [run]);
  const timeline = useMemo(
    () => (run ? runTimelineBounds(run, events) : { start: 0, end: 1 }),
    [run, events],
  );
  const errors = run ? runErrorCount(run) : 0;
  const running = run ? runIsLive(run) : false;
  const tokenTotals = useMemo(() => sumRunTokenUsage(events), [events]);

  // Reset follow mode + freshness tracking when opening a different run.
  useEffect(() => {
    if (!open || !run) return;
    setFollowLatest(true);
    prevCountRef.current = eventCount;
    const ids = new Set(runEvents(run).map((e) => e.id));
    seenIdsRef.current = ids;
    setFreshIds(new Set());
    // Only re-seed when the dialog opens or the selected run changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eventCount snapshot on open
  }, [open, run?.id]);

  // Mark newly arrived span ids so they get the amber fade.
  useEffect(() => {
    if (!open || !run) return;
    const nextFresh = new Set<string>();
    for (const ev of events) {
      if (!seenIdsRef.current.has(ev.id)) {
        nextFresh.add(ev.id);
        seenIdsRef.current.add(ev.id);
      }
    }
    if (nextFresh.size === 0) return;
    setFreshIds((prev) => {
      const merged = new Set(prev);
      for (const id of nextFresh) merged.add(id);
      return merged;
    });
    const timer = window.setTimeout(() => {
      setFreshIds((prev) => {
        const cleaned = new Set(prev);
        for (const id of nextFresh) cleaned.delete(id);
        return cleaned;
      });
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [events, open, run]);

  // Auto-scroll when new events arrive and follow is on.
  useEffect(() => {
    if (!open || !followLatest) {
      prevCountRef.current = eventCount;
      return;
    }
    if (eventCount !== prevCountRef.current || running) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevCountRef.current = eventCount;
  }, [eventCount, followLatest, open, running, events]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance > 80) {
      if (followLatest) setFollowLatest(false);
    } else if (distance < 24 && !followLatest) {
      setFollowLatest(true);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          className={cn(
            'ui-dialog fixed z-50 flex w-[min(1180px,98vw)] flex-col',
            'max-h-[min(92vh,880px)] overflow-hidden rounded-lg',
            'border border-border-primary bg-bg-secondary shadow-lg',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          {run ? (
            <>
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-secondary px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-medium text-text-primary">
                    {run.title}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                    <span>{sourceLabelText(run.source, t)}</span>
                    <span className="tabular-nums">{formatRelative(run.started_at)}</span>
                    <span className="tabular-nums">
                      {events.length}{' '}
                      {events.length === 1 ? t('activity.span') : t('activity.spans')}
                    </span>
                    <span className="tabular-nums">{formatDuration(run.duration_ms)}</span>
                    {tokenTotals.hasAny ? (
                      <TokenUsageLabel totals={tokenTotals} t={t} />
                    ) : null}
                    {errors > 0 ? (
                      <span className="font-medium text-error-text">
                        {errors} {t('activity.errors')}
                      </span>
                    ) : (
                      <span className="text-status-connected-dot">{t('activity.runOk')}</span>
                    )}
                    {(live || running) && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />
                        {t('activity.live')}
                      </span>
                    )}
                  </Dialog.Description>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setFollowLatest(true);
                      requestAnimationFrame(() => {
                        bottomRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'end',
                        });
                      });
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer',
                      followLatest
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-hover-bg',
                    )}
                    title={
                      followLatest
                        ? t('activity.followingLatest')
                        : t('activity.followLatest')
                    }
                  >
                    {followLatest ? <ArrowDown size={12} /> : <Pause size={12} />}
                    {followLatest
                      ? t('activity.followingLatest')
                      : t('activity.followLatest')}
                  </button>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                      aria-label={t('activity.closeRun')}
                    >
                      <X size={16} />
                    </button>
                  </Dialog.Close>
                </div>
              </div>

              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto"
              >
                <div className="sticky top-0 z-[1] flex items-center gap-2.5 border-b border-border-secondary bg-bg-secondary/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-text-tertiary backdrop-blur-sm">
                  <span className="w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{t('activity.colName')}</span>
                  <span className="hidden md:inline w-32 shrink-0 text-center">
                    {t('activity.colTimeline')}
                  </span>
                  <span className="w-12 shrink-0 text-right">{t('activity.colLatency')}</span>
                  <span className="w-[4.75rem] shrink-0 text-right">{t('activity.colTime')}</span>
                </div>
                {events.map((ev) => (
                  <ActivitySpanRow
                    key={ev.id}
                    call={ev}
                    runStart={timeline.start}
                    runEnd={timeline.end}
                    nestedPayload
                    fresh={freshIds.has(ev.id)}
                    onInspect={() => setFollowLatest(false)}
                  />
                ))}
                <div ref={bottomRef} className="h-2" aria-hidden />
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
