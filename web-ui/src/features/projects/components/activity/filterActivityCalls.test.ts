import { describe, it, expect } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import { filterActivityCalls, filterRunsBySearch } from './filterActivityCalls';

function call(partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'id'>): ToolCallRecord {
  return {
    project_id: 'p1',
    session_id: null,
    started_at: 0,
    duration_ms: 1,
    status: 'ok',
    source: 'agent',
    kind: 'shell',
    tool_name: 'Shell',
    meta_tool: null,
    args_json: null,
    result_preview: null,
    result_bytes: null,
    result_tokens: null,
    error_message: null,
    conversation_id: null,
    generation_id: null,
    agent_id: null,
    model: null,
    attributes_json: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ...partial,
  };
}

describe('filterActivityCalls', () => {
  it('returns all calls when query is empty', () => {
    const calls = [call({ id: '1' }), call({ id: '2' })];
    expect(filterActivityCalls(calls, '')).toHaveLength(2);
  });

  it('matches tool name and args', () => {
    const calls = [
      call({ id: '1', tool_name: 'Read', args_json: '{"path":"/foo"}' }),
      call({ id: '2', tool_name: 'Shell', args_json: '{"command":"npm test"}' }),
    ];
    expect(filterActivityCalls(calls, 'npm')).toHaveLength(1);
    expect(filterActivityCalls(calls, '/foo')).toHaveLength(1);
  });
});

describe('filterRunsBySearch', () => {
  it('keeps turns whose title matches', () => {
    const runs = [
      {
        id: 'r1',
        conversationId: 'c1',
        generationId: 'g1',
        title: 'Fix login bug',
        prompt: call({ id: 'p1', tool_name: 'UserPrompt' }),
        spans: [call({ id: 's1', tool_name: 'Read' })],
        started_at: 1,
        source: 'cursor',
        hasError: false,
        duration_ms: 100,
      },
      {
        id: 'r2',
        conversationId: 'c1',
        generationId: 'g2',
        title: 'Add tests',
        prompt: null,
        spans: [call({ id: 's2', tool_name: 'Shell' })],
        started_at: 0,
        source: 'cursor',
        hasError: false,
        duration_ms: 50,
      },
    ];
    expect(filterRunsBySearch(runs, 'login')).toHaveLength(1);
    expect(filterRunsBySearch(runs, 'login')[0]?.spans).toHaveLength(1);
  });
});
