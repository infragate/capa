import { describe, expect, it } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import { groupActivityRuns } from './groupActivityRuns';

function call(
  partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'id' | 'kind' | 'tool_name' | 'started_at'>,
): ToolCallRecord {
  return {
    project_id: 'p',
    session_id: null,
    duration_ms: 10,
    status: 'ok',
    source: 'cursor',
    meta_tool: null,
    args_json: null,
    result_preview: null,
    result_bytes: null,
    result_tokens: null,
    error_message: null,
    agent_id: null,
    ...partial,
  };
}

describe('groupActivityRuns', () => {
  it('groups spans under a prompt into one run', () => {
    const calls = [
      call({ id: '3', kind: 'tool', tool_name: 'owl.check', started_at: 300 }),
      call({ id: '2', kind: 'file', tool_name: 'README.md', started_at: 200 }),
      call({ id: '1', kind: 'prompt', tool_name: 'What is this?', started_at: 100 }),
    ];
    const runs = groupActivityRuns(calls);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.title).toBe('What is this?');
    expect(runs[0]!.spans.map((s) => s.id)).toEqual(['2', '3']);
  });

  it('starts a new run on the next prompt', () => {
    const calls = [
      call({ id: '4', kind: 'shell', tool_name: 'ls', started_at: 400 }),
      call({ id: '3', kind: 'prompt', tool_name: 'second', started_at: 300 }),
      call({ id: '2', kind: 'shell', tool_name: 'dir', started_at: 200 }),
      call({ id: '1', kind: 'prompt', tool_name: 'first', started_at: 100 }),
    ];
    const runs = groupActivityRuns(calls);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.title).toBe('second');
    expect(runs[1]!.title).toBe('first');
  });
});
