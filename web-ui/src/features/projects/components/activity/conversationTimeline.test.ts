import { describe, expect, it } from 'bun:test';
import type { ActivityRun } from './groupActivityRuns';
import {
  runPromptTime,
  runTightBounds,
  sortEventsChronological,
  sortRunsChronological,
} from './conversationTimeline';
import type { ToolCallRecord } from '../../../../types/api';

function run(
  id: string,
  started_at: number,
  duration_ms: number,
  extra?: Partial<ActivityRun> & {
    prompt?: ToolCallRecord | null;
    spans?: ToolCallRecord[];
  },
): ActivityRun {
  return {
    id,
    conversationId: 'conv-1',
    generationId: id,
    title: id,
    prompt: null,
    spans: [],
    started_at,
    source: 'cursor',
    hasError: false,
    duration_ms,
    ...extra,
  };
}

function span(
  id: string,
  started_at: number,
  duration_ms: number,
  status: ToolCallRecord['status'] = 'ok',
  kind = 'agent_tool',
): ToolCallRecord {
  return {
    id,
    project_id: 'p',
    session_id: null,
    started_at,
    duration_ms,
    status,
    source: 'cursor',
    kind,
    tool_name: id,
    meta_tool: null,
    args_json: null,
    result_preview: null,
    result_bytes: null,
    result_tokens: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    error_message: null,
    agent_id: null,
    conversation_id: 'conv-1',
    generation_id: 'gen-1',
    model: null,
    attributes_json: null,
  };
}

describe('conversationTimeline', () => {
  it('sorts by prompt time, not min span time', () => {
    const laterPrompt = run('b', 50, 100, {
      prompt: span('prompt-b', 200, 1, 'ok', 'prompt'),
      spans: [span('tool-b', 50, 10)],
    });
    const earlierPrompt = run('a', 500, 100, {
      prompt: span('prompt-a', 100, 1, 'ok', 'prompt'),
      spans: [span('tool-a', 500, 10)],
    });
    expect(runPromptTime(laterPrompt)).toBe(200);
    expect(runPromptTime(earlierPrompt)).toBe(100);
    expect(sortRunsChronological([laterPrompt, earlierPrompt]).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('uses stop time as the turn end bound', () => {
    const bounds = runTightBounds(
      run('turn-a', 0, 999_999, {
        prompt: span('prompt-a', 0, 1, 'ok', 'prompt'),
        spans: [
          span('tool-a', 10, 80, 'running'),
          span('stop-a', 90, 5, 'ok', 'stop'),
        ],
      }),
      50_000,
    );
    expect(bounds.start).toBe(0);
    expect(bounds.end).toBe(95);
  });

  it('sorts events globally by started_at across generations', () => {
    const genA = span('tool-a', 200, 10);
    genA.generation_id = 'gen-a';
    const genB = span('tool-b', 100, 10);
    genB.generation_id = 'gen-b';
    const sessionStart = span('sess-start', 0, 1, 'ok', 'session');
    sessionStart.tool_name = 'sessionStart';
    sessionStart.generation_id = 'conv-1';
    const sessionEnd = span('sess-end', 500, 1, 'ok', 'session');
    sessionEnd.tool_name = 'sessionEnd';
    sessionEnd.generation_id = 'conv-1';

    const sorted = sortEventsChronological([genA, genB, sessionEnd, sessionStart]);
    expect(sorted.map((e) => e.id)).toEqual([
      'sess-start',
      'tool-b',
      'tool-a',
      'sess-end',
    ]);
  });
});
