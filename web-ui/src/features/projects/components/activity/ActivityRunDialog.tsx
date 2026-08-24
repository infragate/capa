import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import {
  type ActivityRun,
  resolveActivityRunFromCalls,
  sumRunTokenUsage,
} from './groupActivityRuns';
import { ActivityRunFileTree } from './ActivityRunFileTree';
import { ActivityRunSkillsPanel } from './ActivityRunSkillsPanel';
import { ActivityRunSplitPane } from './ActivityRunSplitPane';
import {
  sortEventsChronological,
  sortRunsChronological,
} from './conversationTimeline';
import {
  buildDisplayPathKeyByEventId,
  collectRunFileChanges,
  displayPathKeyFromSpan,
  spanIdsForDisplayPathKey,
} from './buildRunFileTree';
import { filterActivityCalls, filterRunsBySearch } from './filterActivityCalls';
import { ActivityProcessDiagram } from './ActivityProcessDiagram';
import type { ActivityRunRightView } from './ActivityRunViewTabs';
import { useProjectActivityGeneration } from '../../activityHooks';
import { useProject } from '../../hooks';
import {
  aggregateDurationMs,
  runsEvents,
  runTimelineBounds,
} from './activityRunDialogHelpers';
import { ActivityRunDialogHeader } from './ActivityRunDialogHeader';
import { ActivityRunDialogSearch } from './ActivityRunDialogSearch';
import { ActivityRunDialogTimeline } from './ActivityRunDialogTimeline';

interface ActivityRunDialogProps {
  run: ActivityRun | null;
  /** When set, renders every turn in one timeline (conversation / session aggregate). */
  runs?: ActivityRun[] | null;
  /** Override dialog title (e.g. conversation id). */
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  live?: boolean;
  projectId?: string | null;
  projectPath?: string | null;
  /** Live activity feed rows — merged into generation fetch + SSE while open. */
  feedCalls?: ToolCallRecord[];
  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
}

export function ActivityRunDialog({
  run,
  runs = null,
  title: titleOverride,
  open,
  onOpenChange,
  live = false,
  projectId = null,
  projectPath = null,
  feedCalls,
  loading = false,
  error = null,
  emptyLabel,
}: ActivityRunDialogProps) {
  const { t } = useTranslation('projects');
  const { data: project } = useProject(open ? projectId : null);
  const managedSkills = project?.capabilities?.skills ?? [];
  const multiMode = (runs?.length ?? 0) > 0;
  const generationQuery = useProjectActivityGeneration(
    projectId,
    run?.generationId ?? null,
    {
      enabled: open && !multiMode && !!run?.generationId,
      feedCalls,
    },
  );
  const resolvedRun = useMemo(() => {
    if (!run || multiMode) return run;
    if (!run.generationId || !generationQuery.data?.length) return run;
    return resolveActivityRunFromCalls(generationQuery.data, run);
  }, [run, multiMode, generationQuery.data]);
  const activeRuns = multiMode ? runs! : resolvedRun ? [resolvedRun] : [];
  const contentKey = multiMode
    ? activeRuns.map((r) => r.id).join('|')
    : resolvedRun?.id ?? '';
  const hasContent = activeRuns.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(() => new Set());
  const [pickedFilePathKey, setPickedFilePathKey] = useState<string | null>(null);
  const [scrollTreePathKey, setScrollTreePathKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rightView, setRightView] = useState<ActivityRunRightView>('timeline');
  const [processFitToken, setProcessFitToken] = useState(0);

  const onRightViewChange = (view: ActivityRunRightView) => {
    setRightView(view);
    if (view === 'process') {
      setProcessFitToken((token) => token + 1);
    }
  };
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
    let list: ToolCallRecord[];
    if (!searchActive) {
      list = events;
    } else if (multiMode) {
      list = runsEvents(filteredRuns);
    } else {
      return sortEventsChronological(filterActivityCalls(events, search));
    }
    return sortEventsChronological(list);
  }, [searchActive, events, multiMode, filteredRuns, search]);
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

  function onFollowLatest() {
    setFollowLatest(true);
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    });
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
          {loading || (!multiMode && !!run?.generationId && generationQuery.isLoading) ? (
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
              <ActivityRunDialogHeader
                displayTitle={displayTitle}
                displaySource={displaySource}
                displayStartedAt={displayStartedAt}
                displayDuration={displayDuration}
                multiMode={multiMode}
                activeRunCount={activeRuns.length}
                eventCount={events.length}
                tokenTotals={tokenTotals}
                errors={errors}
                live={live}
                running={running}
                rightView={rightView}
                onRightViewChange={onRightViewChange}
                followLatest={followLatest}
                onFollowLatest={onFollowLatest}
                fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen((prev) => !prev)}
              />

              <ActivityRunDialogSearch
                search={search}
                onSearchChange={setSearch}
                searchActive={searchActive}
                matchedCount={displayEvents.length}
                totalCount={events.length}
              />

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
                        projectId={projectId}
                        managedSkills={managedSkills}
                      />
                    </div>
                  </div>
                }
                right={
                  rightView === 'process' ? (
                    <ActivityProcessDiagram
                      runs={processRuns}
                      viewKey={contentKey}
                      fitToken={processFitToken}
                    />
                  ) : (
                    <ActivityRunDialogTimeline
                      scrollRef={scrollRef}
                      bottomRef={bottomRef}
                      onScroll={onScroll}
                      displayEvents={displayEvents}
                      searchActive={searchActive}
                      timeline={timeline}
                      freshIds={freshIds}
                      fileLinkedSpanIds={fileLinkedSpanIds}
                      onInspect={() => setFollowLatest(false)}
                      onExpandedChange={onSpanExpandedChange}
                    />
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
