import type { ToolCallRecord } from '../../../../types/api';
import type { ActivityRun } from './groupActivityRuns';

export function runEvents(run: ActivityRun): ToolCallRecord[] {
  return [...(run.prompt ? [run.prompt] : []), ...run.spans];
}

export function runsEvents(runs: ActivityRun[]): ToolCallRecord[] {
  return runs.flatMap(runEvents);
}

export function aggregateDurationMs(runs: ActivityRun[]): number | null {
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

export function runIsLive(run: ActivityRun): boolean {
  return runEvents(run).some((e) => e.status === 'running');
}

/** Absolute [start, end] of the run timeline for Gantt positioning. */
export function runTimelineBounds(
  run: ActivityRun,
  events: ToolCallRecord[],
): {
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
