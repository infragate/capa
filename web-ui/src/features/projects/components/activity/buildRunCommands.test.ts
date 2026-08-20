import { describe, it, expect } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import {
  collectRunCommands,
  extractCommandFromSpan,
  filterRunCommands,
  isCommandSpan,
} from './buildRunCommands';

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

describe('buildRunCommands', () => {
  it('detects shell spans and agent shell tools', () => {
    expect(isCommandSpan(call({ id: '1', kind: 'shell' }))).toBe(true);
    expect(
      isCommandSpan(call({ id: '2', kind: 'agent_tool', tool_name: 'Shell' })),
    ).toBe(true);
    expect(isCommandSpan(call({ id: '3', kind: 'file', tool_name: 'Read' }))).toBe(false);
  });

  it('extracts command from args_json', () => {
    const span = call({
      id: '1',
      args_json: JSON.stringify({ command: 'npm test' }),
    });
    expect(extractCommandFromSpan(span)).toBe('npm test');
  });

  it('collects and filters commands', () => {
    const events = [
      call({
        id: 'a',
        args_json: JSON.stringify({ command: 'git status' }),
      }),
      call({
        id: 'b',
        kind: 'file',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: '/x' }),
      }),
      call({
        id: 'c',
        args_json: JSON.stringify({ command: 'npm run build' }),
      }),
    ];
    const entries = collectRunCommands(events);
    expect(entries).toHaveLength(2);
    expect(filterRunCommands(entries, 'npm')).toHaveLength(1);
  });
});
