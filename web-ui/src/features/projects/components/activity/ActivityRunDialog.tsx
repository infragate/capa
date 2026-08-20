import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, GitBranch, Loader2, Maximize2, Minimize2, Pause, Search, X } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import {
  type ActivityRun,
  formatDuration,
  formatRelative,
  sumRunTokenUsage,
} from './groupActivityRuns';
import { ActivitySpanRow } from './ActivitySpanRow';
import { ActivityRunFileTree } from './ActivityRunFileTree';
import { ActivityRunCommandsList } from './ActivityRunCommandsList';
import { ActivityRunSkillsPanel } from './ActivityRunSkillsPanel';
import { ActivityRunSplitPane } from './ActivityRunSplitPane';
import { ActivityConversationTimeline } from './ActivityConversationTimeline';
import {
  buildConversationTimelineBlocks,
  sortRunsChronological,
} from './conversationTimeline';
import {
  buildDisplayPathKeyByEventId,
  collectRunFileChanges,
  displayPathKeyFromSpan,
  spanIdsForDisplayPathKey,
} from './buildRunFileTree';
import { sourceLabelText, TokenUsageLabel } from './ActivityShared';
import { filterActivityCalls, filterRunsBySearch } from './filterActivityCalls';
import { ActivityProcessDiagram } from './ActivityProcessDiagram';

interface ActivityRunDialogProps {
  run: ActivityRun | null;
  /** When set, renders every turn in one timeline (conversation / session aggregate). */
  runs?: ActivityRun[] | null;
  /** Override dialog title (e.g. conversation id). */
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  live?: boolean;
  projectPath?: string | null;
  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
}

function runEvents(run: ActivityRun): ToolCallRecord[] {
  return [...(run.prompt ? [run.prompt] : []), ...run.spans];
}

function runsEvents(runs: ActivityRun[]): ToolCallRecord[] {
  return runs.flatMap(runEvents);
}

function aggregateDurationMs(runs: ActivityRun[]): number | null {
  const events = runsEvents(runs);
  if (events.length === 0) return null;
  const now = Date.now();
  let start = events[0]!.started_at;
  let end = start;
  for (const e of events) {
    start = Math.min(start, e.started_at);
    const spanEnd =
      e.duration_ms != null
        ? e.started_at + e.duration_ms
        : e.status === 'running'
          ? Math.max(e.started_at, now)
          : e.started_at;
    end = Math.max(end, spanEnd);
  }
  if (events.some((e) => e.status === 'running')) end = Math.max(end, now);
  return Math.max(end - start, 0);
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
  runs = null,
  title: titleOverride,
  open,
  onOpenChange,
  live = false,
  projectPath = null,
  loading = false,
  error = null,
  emptyLabel,
}: ActivityRunDialogProps) {
  const { t } = useTranslation('projects');
  const multiMode = (runs?.length ?? 0) > 0;
  const activeRuns = multiMode ? runs! : run ? [run] : [];
  const contentKey = multiMode
    ? activeRuns.map((r) => r.id).join('|')
    : run?.id ?? '';
  const hasContent = activeRuns.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(() => new Set());
  const [pickedFilePathKey, setPickedFilePathKey] = useState<string | null>(null);
  const [scrollTreePathKey, setScrollTreePathKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rightView, setRightView] = useState<'timeline' | 'process'>('timeline');
  const eventCount = hasContent ? runsEvents(activeRuns).length : 0;
  const prevCountRef = useRef(eventCount);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const freshTimersRef = useRef<Map<string, number>>(new Map());
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const events = useMemo(
    () => (hasContent ? runsEvents(activeRuns) : []),
    [activeRuns, hasContent],
  );
  const searchActive = search.trim().length > 0;
  const filteredRuns = useMemo(
    () =>
      multiMode
        ? sortRunsChronological(filterRunsBySearch(activeRuns, search))
        : activeRuns,
    [multiMode, activeRuns, search],
  );
  const displayEvents = useMemo(() => {
    if (!searchActive) return events;
    if (multiMode) return runsEvents(filteredRuns);
    return filterActivityCalls(events, search);
  }, [searchActive, events, multiMode, filteredRuns, search]);
  const displayTimelineBlocks = useMemo(
    () => (multiMode ? buildConversationTimelineBlocks(filteredRuns) : []),
    [multiMode, filteredRuns],
  );
  const runBoundsById = useMemo(() => {
    const map = new Map<string, { start: number; end: number }>();
    for (const activeRun of multiMode ? filteredRuns : activeRuns) {
      map.set(activeRun.id, runTimelineBounds(activeRun, runEvents(activeRun)));
    }
    return map;
  }, [activeRuns, filteredRuns, multiMode]);
  const timeline = useMemo(() => {
    if (!hasContent) return { start: 0, end: 1 };
    if (multiMode) {
      const start = Math.min(...events.map((e) => e.started_at));
      let end = start;
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
      if (events.some((e) => e.status === 'running')) end = Math.max(end, now);
      return { start, end: Math.max(end, start + 1) };
    }
    return run ? runTimelineBounds(run, events) : { start: 0, end: 1 };
  }, [hasContent, multiMode, events, run]);
  const errors = useMemo(
    () => events.filter((e) => e.status === 'error').length,
    [events],
  );
  const running = useMemo(
    () => events.some((e) => e.status === 'running'),
    [events],
  );
  const tokenTotals = useMemo(() => sumRunTokenUsage(events), [events]);
  const displayTitle = titleOverride ?? (multiMode ? t('activity.allTurns') : run?.title ?? '');
  const displayStartedAt = multiMode
    ? Math.max(...activeRuns.map((r) => r.started_at))
    : run?.started_at ?? 0;
  const displayDuration = multiMode
    ? aggregateDurationMs(activeRuns)
    : run?.duration_ms ?? null;
  const displaySource = multiMode ? activeRuns.find((r) => r.source)?.source ?? null : run?.source ?? null;
  const fileTreeRunId = multiMode
    ? `multi:${activeRuns[0]?.conversationId ?? activeRuns[0]?.id ?? 'aggregate'}`
    : run?.id ?? 'run';

  const processRuns = useMemo(() => {
    const source = multiMode ? filteredRuns : activeRuns;
    if (!searchActive) return source;
    const ids = new Set(displayEvents.map((e) => e.id));
    return source
      .map((activeRun) => ({
        ...activeRun,
        prompt:
          activeRun.prompt && ids.has(activeRun.prompt.id) ? activeRun.prompt : null,
        spans: activeRun.spans.filter((s) => ids.has(s.id)),
      }))
      .filter((activeRun) => activeRun.prompt || activeRun.spans.length > 0);
  }, [multiMode, filteredRuns, activeRuns, searchActive, displayEvents]);

  const fileEntries = useMemo(
    () => collectRunFileChanges(displayEvents, { realProjectPath: projectPath }),
    [displayEvents, projectPath],
  );

  const pathOptions = useMemo(
    () => ({ realProjectPath: projectPath }),
    [projectPath],
  );

  const pathKeyByEventId = useMemo(
    () => buildDisplayPathKeyByEventId(displayEvents, fileEntries, pathOptions),
    [displayEvents, fileEntries, pathOptions],
  );

  const selectedPathKeys = useMemo(() => {
    if (pickedFilePathKey) return new Set([pickedFilePathKey]);
    const keys = new Set<string>();
    for (const id of expandedSpanIds) {
      const ev = displayEvents.find((e) => e.id === id);
      if (!ev) continue;
      const key = displayPathKeyFromSpan(ev, fileEntries, pathOptions);
      if (key) keys.add(key);
    }
    return keys;
  }, [pickedFilePathKey, expandedSpanIds, displayEvents, fileEntries, pathOptions]);

  const fileLinkedSpanIds = useMemo(() => {
    if (!pickedFilePathKey) return new Set<string>();
    return new Set(spanIdsForDisplayPathKey(pickedFilePathKey, pathKeyByEventId));
  }, [pickedFilePathKey, pathKeyByEventId]);

  function onSpanExpandedChange(nextOpen: boolean, call: ToolCallRecord) {
    setPickedFilePathKey(null);
    setExpandedSpanIds((prev) => {
      const next = new Set(prev);
      if (nextOpen) next.add(call.id);
      else next.delete(call.id);
      return next;
    });
    if (nextOpen) {
      setFollowLatest(false);
      const key = displayPathKeyFromSpan(call, fileEntries, pathOptions);
      if (key) setScrollTreePathKey(key);
    }
  }

  function onFileSelect(pathKey: string) {
    setPickedFilePathKey(pathKey);
    setScrollTreePathKey(pathKey);
    setFollowLatest(false);
    const spanIds = spanIdsForDisplayPathKey(pathKey, pathKeyByEventId);
    requestAnimationFrame(() => {
      const first = spanIds[0];
      if (first) {
        document
          .getElementById(`activity-span-${first}`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function onCommandSelect(spanId: string) {
    setPickedFilePathKey(null);
    setExpandedSpanIds(new Set([spanId]));
    setFollowLatest(false);
    requestAnimationFrame(() => {
      document
        .getElementById(`activity-span-${spanId}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function clearFreshTimers() {
    for (const timer of freshTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    freshTimersRef.current.clear();
  }

  // Reset follow mode + freshness tracking when opening a different run.
  useEffect(() => {
    if (!open || !hasContent) return;
    setFollowLatest(true);
    setFullscreen(false);
    setExpandedSpanIds(new Set());
    setPickedFilePathKey(null);
    setScrollTreePathKey(null);
    setSearch('');
    setRightView('timeline');
    prevCountRef.current = eventCount;
    seenIdsRef.current = new Set(events.map((e) => e.id));
    clearFreshTimers();
    setFreshIds(new Set());
    // Only re-seed when the dialog opens or the viewed run(s) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eventCount snapshot on open
  }, [open, contentKey]);

  // Drop pending highlight timers on unmount.
  useEffect(() => () => clearFreshTimers(), []);

  // Mark newly arrived span ids so they get the amber fade.
  // Per-id timers so rapid event streams don't cancel earlier removals.
  useEffect(() => {
    if (!open || !hasContent) return;
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
    for (const id of nextFresh) {
      const existing = freshTimersRef.current.get(id);
      if (existing != null) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        freshTimersRef.current.delete(id);
        setFreshIds((prev) => {
          if (!prev.has(id)) return prev;
          const cleaned = new Set(prev);
          cleaned.delete(id);
          return cleaned;
        });
      }, 2600);
      freshTimersRef.current.set(id, timer);
    }
  }, [events, open, hasContent]);

  // Auto-scroll when new events arrive and follow is on.
  useEffect(() => {
    if (!open || !followLatest || searchActive) {
      prevCountRef.current = eventCount;
      return;
    }
    if (eventCount !== prevCountRef.current || running) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevCountRef.current = eventCount;
  }, [eventCount, followLatest, open, running, events, searchActive]);

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
            'ui-dialog fixed z-50 flex min-h-[240px] flex-col overflow-hidden border border-border-primary bg-bg-secondary shadow-lg',
            fullscreen
              ? 'inset-0 h-full w-full max-h-none max-w-none rounded-none'
              : 'max-h-[min(94vh,960px)] w-[min(1600px,96vw)] rounded-lg',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-text-tertiary">
              <Loader2 size={16} className="animate-spin" />
              {t('activity.loading')}
            </div>
          ) : error ? (
            <p className="flex-1 px-5 py-12 text-sm text-error-text">{error}</p>
          ) : !hasContent ? (
            <p className="flex-1 px-5 py-12 text-center text-sm text-text-tertiary">
              {emptyLabel ?? t('activity.empty')}
            </p>
          ) : (
            <>
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-secondary px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-medium text-text-primary">
                    {displayTitle}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                    <span>{sourceLabelText(displaySource, t)}</span>
                    <span className="tabular-nums">{formatRelative(displayStartedAt)}</span>
                    {multiMode ? (
                      <span className="tabular-nums">
                        {activeRuns.length}{' '}
                        {activeRuns.length === 1
                          ? t('activity.generation')
                          : t('activity.generations')}
                      </span>
                    ) : null}
                    <span className="tabular-nums">
                      {events.length}{' '}
                      {events.length === 1 ? t('activity.span') : t('activity.spans')}
                    </span>
                    <span className="tabular-nums">{formatDuration(displayDuration)}</span>
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
                  <button
                    type="button"
                    onClick={() =>
                      setRightView((v) => (v === 'process' ? 'timeline' : 'process'))
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer',
                      rightView === 'process'
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-hover-bg',
                    )}
                    title={t('activity.processAnalysis.toggle')}
                  >
                    <GitBranch size={12} />
                    {t('activity.processAnalysis.button')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreen((prev) => !prev)}
                    className="rounded-md p-1.5 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                    title={
                      fullscreen ? t('activity.exitFullscreen') : t('activity.enterFullscreen')
                    }
                    aria-label={
                      fullscreen ? t('activity.exitFullscreen') : t('activity.enterFullscreen')
                    }
                  >
                    {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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

              <div className="shrink-0 border-b border-border-secondary px-5 py-2.5">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('activity.runSearchPlaceholder')}
                    className="w-full rounded-md border border-border-secondary bg-bg-secondary py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:outline-none"
                  />
                </div>
                {searchActive ? (
                  <p className="mt-1.5 text-[11px] text-text-tertiary">
                    {displayEvents.length === 0
                      ? t('activity.runSearchNoResults')
                      : t('activity.searchMatchCount', {
                          matched: displayEvents.length,
                          total: events.length,
                        })}
                  </p>
                ) : null}
              </div>

              <ActivityRunSplitPane
                defaultLeftWidth={320}
                minLeftWidth={240}
                maxLeftWidth={520}
                left={
                  <div className="flex min-h-0 h-full">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <ActivityRunFileTree
                          events={displayEvents}
                          runId={fileTreeRunId}
                          projectPath={projectPath}
                          selectedPathKeys={selectedPathKeys}
                          scrollPathKey={scrollTreePathKey}
                          onFileSelect={onFileSelect}
                        />
                      </div>
                      <ActivityRunSkillsPanel
                        events={displayEvents}
                        projectPath={projectPath}
                      />
                    </div>
                    <div className="hidden min-h-0 w-[min(280px,38%)] shrink-0 lg:flex">
                      <ActivityRunCommandsList
                        events={displayEvents}
                        runId={fileTreeRunId}
                        selectedSpanIds={expandedSpanIds}
                        onCommandSelect={onCommandSelect}
                      />
                    </div>
                  </div>
                }
                right={
                  rightView === 'process' ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <ActivityProcessDiagram runs={processRuns} viewKey={contentKey} />
                    </div>
                  ) : (
                  <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="min-h-0 h-full overflow-y-auto"
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
                    {displayEvents.length === 0 && searchActive ? (
                      <p className="px-4 py-8 text-center text-sm text-text-tertiary">
                        {t('activity.runSearchNoResults')}
                      </p>
                    ) : multiMode ? (
                      <ActivityConversationTimeline
                        blocks={displayTimelineBlocks}
                        runBoundsById={runBoundsById}
                        freshIds={freshIds}
                        fileLinkedSpanIds={fileLinkedSpanIds}
                        onInspect={() => setFollowLatest(false)}
                        onSpanExpandedChange={onSpanExpandedChange}
                      />
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
                          onInspect={() => setFollowLatest(false)}
                          onExpandedChange={onSpanExpandedChange}
                        />
                      ))
                    )}
                    <div ref={bottomRef} className="h-2" aria-hidden />
                  </div>
                  )
                }
              />
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
