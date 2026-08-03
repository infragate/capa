import { describe, expect, it } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import {
  groupActivityConversations,
  groupActivityRuns,
  isCapaToolCall,
} from './groupActivityRuns';

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
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    error_message: null,
    agent_id: null,
    conversation_id: null,
    generation_id: null,
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

  it('closes a run on stop and orphans become singleton runs', () => {
    const calls = [
      call({ id: '4', kind: 'shell', tool_name: 'orphan', started_at: 400 }),
      call({ id: '3', kind: 'stop', tool_name: 'stop', started_at: 300 }),
      call({ id: '2', kind: 'shell', tool_name: 'ls', started_at: 200 }),
      call({ id: '1', kind: 'prompt', tool_name: 'do it', started_at: 100 }),
    ];
    const runs = groupActivityRuns(calls);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.title).toBe('orphan');
    expect(runs[1]!.spans.map((s) => s.id)).toEqual(['2', '3']);
  });

  it('opens a run on session start and closes on session end', () => {
    const calls = [
      call({ id: '3', kind: 'session', tool_name: 'sessionEnd', started_at: 300 }),
      call({ id: '2', kind: 'shell', tool_name: 'ls', started_at: 200 }),
      call({ id: '1', kind: 'session', tool_name: 'sessionStart', started_at: 100 }),
    ];
    const runs = groupActivityRuns(calls);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.spans.map((s) => s.id)).toEqual(['1', '2', '3']);
  });

  it('flags hasError when any span errors', () => {
    const calls = [
      call({
        id: '2',
        kind: 'shell',
        tool_name: 'bad',
        started_at: 200,
        status: 'error',
      }),
      call({ id: '1', kind: 'prompt', tool_name: 'go', started_at: 100 }),
    ];
    const runs = groupActivityRuns(calls);
    expect(runs[0]!.hasError).toBe(true);
  });

  it('groups by conversation then generation when ids are present', () => {
    const calls = [
      call({
        id: '4',
        kind: 'agent_tool',
        tool_name: 'Read',
        started_at: 400,
        conversation_id: 'conv-a',
        generation_id: 'gen-2',
      }),
      call({
        id: '3',
        kind: 'prompt',
        tool_name: 'second turn',
        started_at: 300,
        conversation_id: 'conv-a',
        generation_id: 'gen-2',
      }),
      call({
        id: '2',
        kind: 'shell',
        tool_name: 'ls',
        started_at: 200,
        conversation_id: 'conv-a',
        generation_id: 'gen-1',
      }),
      call({
        id: '1',
        kind: 'prompt',
        tool_name: 'first turn',
        started_at: 100,
        conversation_id: 'conv-a',
        generation_id: 'gen-1',
      }),
      call({
        id: '5',
        kind: 'prompt',
        tool_name: 'other chat',
        started_at: 500,
        conversation_id: 'conv-b',
        generation_id: 'gen-x',
      }),
    ];
    const conversations = groupActivityConversations(calls);
    expect(conversations).toHaveLength(2);
    expect(conversations[0]!.id).toBe('conv-b');
    expect(conversations[1]!.id).toBe('conv-a');
    expect(conversations[1]!.generations).toHaveLength(2);
    expect(conversations[1]!.generations[0]!.title).toBe('second turn');
    expect(conversations[1]!.generations[1]!.title).toBe('first turn');
  });
});

describe('isCapaToolCall', () => {
  it('detects capa MCP tracer kinds', () => {
    expect(isCapaToolCall({ kind: 'tool' })).toBe(true);
    expect(isCapaToolCall({ kind: 'call_tool' })).toBe(true);
    expect(isCapaToolCall({ kind: 'setup_tools' })).toBe(true);
    expect(isCapaToolCall({ kind: 'agent_tool', meta_tool: 'call_tool' })).toBe(true);
  });

  it('ignores provider-native agent events', () => {
    expect(isCapaToolCall({ kind: 'agent_tool' })).toBe(false);
    expect(isCapaToolCall({ kind: 'shell' })).toBe(false);
    expect(isCapaToolCall({ kind: 'prompt' })).toBe(false);
  });
});
