import type { ToolCallRecord } from '../../../../types/api';
import {
  isActivityRunCloser,
  isActivityRunOpener,
} from '../../../../../../src/shared/activity-run-boundary';

/** A LangSmith-style “run”: a user prompt (optional) + the spans that followed. */
export interface ActivityRun {
  id: string;
  title: string;
  prompt: ToolCallRecord | null;
  spans: ToolCallRecord[];
  started_at: number;
  source: string | null;
  hasError: boolean;
  duration_ms: number | null;
}

/**
 * Group a newest-first activity feed into runs.
 * A `prompt` opens a run; `stop` closes it. Orphan spans become singleton runs.
 */
export function groupActivityRuns(calls: ToolCallRecord[]): ActivityRun[] {
  const chronological = [...calls].sort((a, b) => a.started_at - b.started_at);
  const groups: ActivityRun[] = [];
  let current: ActivityRun | null = null;

  const flush = () => {
    if (!current) return;
    finalizeRun(current);
    groups.push(current);
    current = null;
  };

  for (const call of chronological) {
    if (isActivityRunOpener(call) && call.kind === 'prompt') {
      flush();
      current = {
        id: call.id,
        title: call.tool_name || 'prompt',
        prompt: call,
        spans: [],
        started_at: call.started_at,
        source: call.source,
        hasError: call.status === 'error',
        duration_ms: null,
      };
      continue;
    }

    if (isActivityRunOpener(call)) {
      flush();
      current = {
        id: call.id,
        title: call.tool_name,
        prompt: null,
        spans: [call],
        started_at: call.started_at,
        source: call.source,
        hasError: call.status === 'error',
        duration_ms: null,
      };
      continue;
    }

    if (!current) {
      current = {
        id: call.id,
        title: call.tool_name,
        prompt: null,
        spans: [call],
        started_at: call.started_at,
        source: call.source,
        hasError: call.status === 'error',
        duration_ms: null,
      };
    } else {
      current.spans.push(call);
      if (call.source && !current.source) current.source = call.source;
      if (call.status === 'error') current.hasError = true;
    }

    if (isActivityRunCloser(call)) {
      flush();
    }
  }
  flush();

  // Newest runs first (matches feed order users expect).
  return groups.reverse();
}

function finalizeRun(run: ActivityRun): void {
  const points = [
    ...(run.prompt ? [run.prompt] : []),
    ...run.spans,
  ];
  if (points.length === 0) return;

  let minStart = points[0]!.started_at;
  let maxEnd = points[0]!.started_at + (points[0]!.duration_ms ?? 0);
  for (const p of points) {
    minStart = Math.min(minStart, p.started_at);
    const spanEnd =
      p.duration_ms != null
        ? p.started_at + p.duration_ms
        : p.status === 'running'
          ? Math.max(p.started_at, Date.now())
          : p.started_at;
    maxEnd = Math.max(maxEnd, spanEnd);
  }
  run.started_at = minStart;
  run.duration_ms = Math.max(0, maxEnd - minStart);

  if (!run.prompt && run.spans.length === 1) {
    run.title = run.spans[0]!.tool_name;
  }
}

export function maxSpanDuration(runs: ActivityRun[]): number {
  let max = 1;
  for (const run of runs) {
    for (const span of run.spans) {
      if (typeof span.duration_ms === 'number' && span.duration_ms > max) {
        max = span.duration_ms;
      }
    }
    if (run.prompt && typeof run.prompt.duration_ms === 'number' && run.prompt.duration_ms > max) {
      max = run.prompt.duration_ms;
    }
  }
  return max;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

/** Local wall-clock time for span rows (HH:mm:ss). */
export function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export interface RunTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** True when at least one usage field was present on a span. */
  hasAny: boolean;
}

/** Sum provider-reported usage across a run's events. */
export function sumRunTokenUsage(
  events: Array<Pick<
    ToolCallRecord,
    'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'
  >>,
): RunTokenTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let hasAny = false;
  for (const e of events) {
    if (e.input_tokens != null) {
      input += e.input_tokens;
      hasAny = true;
    }
    if (e.output_tokens != null) {
      output += e.output_tokens;
      hasAny = true;
    }
    if (e.cache_read_tokens != null) {
      cacheRead += e.cache_read_tokens;
      hasAny = true;
    }
    if (e.cache_write_tokens != null) {
      cacheWrite += e.cache_write_tokens;
      hasAny = true;
    }
  }
  return { input, output, cacheRead, cacheWrite, hasAny };
}

export function hasTokenUsage(
  call: Pick<
    ToolCallRecord,
    'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'
  >,
): boolean {
  return (
    call.input_tokens != null ||
    call.output_tokens != null ||
    call.cache_read_tokens != null ||
    call.cache_write_tokens != null
  );
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'agent_tool':
      return 'tool';
    case 'agent_mcp':
      return 'mcp';
    case 'setup_tools':
      return 'setup';
    case 'call_tool':
      return 'call';
    default:
      return kind;
  }
}

/**
 * True for spans that went through capa's MCP / `capa sh` tracer
 * (as opposed to provider-native agent hooks).
 */
export function isCapaToolCall(call: {
  kind: string;
  meta_tool?: string | null;
}): boolean {
  if (call.kind === 'setup_tools' || call.kind === 'call_tool' || call.kind === 'tool') {
    return true;
  }
  const meta = call.meta_tool;
  return meta === 'call_tool' || meta === 'setup_tools';
}
