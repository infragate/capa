import type { ToolCallRecord } from '../../../../types/api';
import type { ActivityRun } from './groupActivityRuns';

export function filterActivityCalls(
  calls: ToolCallRecord[],
  query: string,
): ToolCallRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return calls;
  return calls.filter((c) => {
    const haystack = [
      c.tool_name,
      c.args_json,
      c.result_preview,
      c.error_message,
      c.session_id,
      c.conversation_id,
      c.generation_id,
      c.kind,
      c.source,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function runEventsForFilter(run: ActivityRun): ToolCallRecord[] {
  return [...(run.prompt ? [run.prompt] : []), ...run.spans];
}

/** Filter turns/spans for the run dialog search (includes turn title matches). */
export function filterRunsBySearch(runs: ActivityRun[], query: string): ActivityRun[] {
  const q = query.trim();
  if (!q) return runs;
  const lower = q.toLowerCase();
  return runs
    .map((run) => {
      if (run.title.toLowerCase().includes(lower)) return run;
      const filtered = filterActivityCalls(runEventsForFilter(run), q);
      if (filtered.length === 0) return null;
      const ids = new Set(filtered.map((f) => f.id));
      return {
        ...run,
        prompt: run.prompt && ids.has(run.prompt.id) ? run.prompt : null,
        spans: run.spans.filter((s) => ids.has(s.id)),
      };
    })
    .filter((r): r is ActivityRun => r != null);
}

export function sessionIdFromRun(
  prompt: ToolCallRecord | null,
  spans: ToolCallRecord[],
): string | null {
  if (prompt?.session_id) return prompt.session_id;
  for (const span of spans) {
    if (span.session_id) return span.session_id;
  }
  return null;
}
