import type { ActivityRun } from './groupActivityRuns';
import { sessionIdFromRun } from './filterActivityCalls';

export function runEventsForTimeline(run: ActivityRun) {
  return [...(run.prompt ? [run.prompt] : []), ...run.spans];
}

export function runEndTime(run: ActivityRun, nowMs: number = Date.now()): number {
  const events = runEventsForTimeline(run);
  if (events.length === 0) {
    return run.started_at + (run.duration_ms ?? 0);
  }
  let end = run.started_at + (run.duration_ms ?? 0);
  for (const e of events) {
    const spanEnd =
      e.duration_ms != null
        ? e.started_at + e.duration_ms
        : e.status === 'running'
          ? Math.max(e.started_at, nowMs)
          : e.started_at;
    end = Math.max(end, spanEnd);
  }
  if (events.some((e) => e.status === 'running')) {
    end = Math.max(end, nowMs);
  }
  return end;
}

export function sortRunsChronological(runs: ActivityRun[]): ActivityRun[] {
  return [...runs].sort((a, b) => {
    if (a.started_at !== b.started_at) return a.started_at - b.started_at;
    return a.id.localeCompare(b.id);
  });
}

export function runsOverlap(
  a: ActivityRun,
  b: ActivityRun,
  nowMs: number = Date.now(),
): boolean {
  return a.started_at < runEndTime(b, nowMs) && b.started_at < runEndTime(a, nowMs);
}

export function sessionIdForRun(run: ActivityRun): string | null {
  return sessionIdFromRun(run.prompt, run.spans);
}

export type ConversationTimelineBlock =
  | { kind: 'single'; run: ActivityRun }
  | {
      kind: 'concurrent';
      runs: ActivityRun[];
      started_at: number;
      ended_at: number;
    };

function overlapComponents(runs: ActivityRun[], nowMs: number): ActivityRun[][] {
  const n = runs.length;
  if (n === 0) return [];
  const parent = runs.map((_, i) => i);

  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (runsOverlap(runs[i]!, runs[j]!, nowMs)) union(i, j);
    }
  }

  const groups = new Map<number, ActivityRun[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(runs[i]!);
    else groups.set(root, [runs[i]!]);
  }

  return [...groups.values()]
    .map((group) => sortRunsChronological(group))
    .sort((a, b) => a[0]!.started_at - b[0]!.started_at);
}

/**
 * Order turns earliest-first and group overlapping/concurrent turns into
 * side-by-side blocks for the all-turns conversation view.
 */
export function buildConversationTimelineBlocks(
  runs: ActivityRun[],
  nowMs: number = Date.now(),
): ConversationTimelineBlock[] {
  const sorted = sortRunsChronological(runs);
  const components = overlapComponents(sorted, nowMs);
  const blocks: ConversationTimelineBlock[] = [];

  for (const component of components) {
    if (component.length === 1) {
      blocks.push({ kind: 'single', run: component[0]! });
      continue;
    }
    blocks.push({
      kind: 'concurrent',
      runs: component,
      started_at: Math.min(...component.map((r) => r.started_at)),
      ended_at: Math.max(...component.map((r) => runEndTime(r, nowMs))),
    });
  }

  return blocks;
}

export const CONCURRENT_LANE_BORDER = [
  'border-l-accent-primary',
  'border-l-status-connected',
  'border-l-[hsl(280_65%_58%)]',
  'border-l-[hsl(32_85%_52%)]',
] as const;

export function concurrentGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  return 'grid-cols-3';
}
