import type { ToolCallRecord } from '../../../../types/api';
import type { ActivityRun } from './groupActivityRuns';
import { sessionIdFromRun } from './filterActivityCalls';

export function runEventsForTimeline(run: ActivityRun) {
  const events = [...(run.prompt ? [run.prompt] : []), ...run.spans];
  return events.sort((a, b) => {
    if (a.started_at !== b.started_at) return a.started_at - b.started_at;
    return a.id.localeCompare(b.id);
  });
}

function isRunCloserEvent(e: { kind: string; tool_name: string }): boolean {
  if (e.kind === 'stop') return true;
  if (e.kind === 'session' && /end/i.test(e.tool_name)) return true;
  return false;
}

/** When the user sent the prompt — stable sort key for generations in a conversation. */
export function runPromptTime(run: ActivityRun): number {
  if (run.prompt) return run.prompt.started_at;
  const events = runEventsForTimeline(run);
  if (events.length > 0) return Math.min(...events.map((e) => e.started_at));
  return run.started_at;
}

/** Wall-clock bounds for timeline bars within one generation. */
export function runTightBounds(
  run: ActivityRun,
  nowMs: number = Date.now(),
): { start: number; end: number } {
  const events = runEventsForTimeline(run);
  if (events.length === 0) {
    const end = run.started_at + (run.duration_ms ?? 0);
    return { start: run.started_at, end: Math.max(end, run.started_at + 1) };
  }

  const start = runPromptTime(run);
  const stop = [...events].reverse().find(isRunCloserEvent) ?? events.find(isRunCloserEvent);
  if (stop) {
    return {
      start,
      end: Math.max(stop.started_at + (stop.duration_ms ?? 0), start + 1),
    };
  }

  const hasRunning = events.some((e) => e.status === 'running');
  let end = start;
  for (const e of events) {
    let spanEnd = e.duration_ms != null ? e.started_at + e.duration_ms : e.started_at;
    if (e.status === 'running' && hasRunning) spanEnd = Math.max(spanEnd, nowMs);
    end = Math.max(end, spanEnd);
  }
  if (hasRunning) end = Math.max(end, nowMs);
  return { start, end: Math.max(end, start + 1) };
}

/** @deprecated Prefer runTightBounds */
export function runEndTime(run: ActivityRun, nowMs: number = Date.now()): number {
  return runTightBounds(run, nowMs).end;
}

/** @deprecated Prefer runTightBounds */
export function runOverlapEndTime(run: ActivityRun, nowMs: number = Date.now()): number {
  return runTightBounds(run, nowMs).end;
}

export function sortRunsChronological(runs: ActivityRun[]): ActivityRun[] {
  return [...runs].sort((a, b) => {
    const ta = runPromptTime(a);
    const tb = runPromptTime(b);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function sortEventsChronological(
  events: ToolCallRecord[],
): ToolCallRecord[] {
  return [...events].sort((a, b) => {
    if (a.started_at !== b.started_at) return a.started_at - b.started_at;
    return a.id.localeCompare(b.id);
  });
}

export function sessionIdForRun(run: ActivityRun): string | null {
  return sessionIdFromRun(run.prompt, run.spans);
}

export type ConversationTimelineBlock = {
  kind: 'single';
  run: ActivityRun;
};

/** @deprecated All-turns view renders a flat chronological event list. */
export function buildConversationTimelineBlocks(
  runs: ActivityRun[],
): ConversationTimelineBlock[] {
  return sortRunsChronological(runs).map((run) => ({ kind: 'single', run }));
}
