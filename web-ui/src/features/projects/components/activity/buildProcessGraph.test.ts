import { describe, expect, it } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import type { ActivityRun } from './groupActivityRuns';
import {
  PROMPT_NODE_ID,
  SHELL_NODE_ID,
  buildProcessGraph,
  processActivityForSpan,
  toMermaidFlowchart,
  type MermaidClassColors,
} from './buildProcessGraph';

function call(
  partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'id' | 'kind' | 'tool_name'>,
): ToolCallRecord {
  return {
    project_id: 'p',
    session_id: null,
    started_at: 1,
    duration_ms: 1,
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
    model: null,
    attributes_json: null,
    ...partial,
  };
}

function run(
  spans: ToolCallRecord[],
  prompt: ToolCallRecord | null = null,
  id = 'run-1',
): ActivityRun {
  return {
    id,
    conversationId: null,
    generationId: id,
    title: 'Run',
    prompt,
    spans,
    started_at: prompt?.started_at ?? spans[0]?.started_at ?? 1,
    source: 'cursor',
    hasError: false,
    duration_ms: 100,
  };
}

describe('buildProcessGraph', () => {
  it('starts traces with a Prompt node and links to the first tool', () => {
    const prompt = call({
      id: 'p',
      kind: 'prompt',
      tool_name: 'user message',
      started_at: 0,
    });
    const graph = buildProcessGraph([
      run(
        [
          call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1 }),
          call({ id: '2', kind: 'agent_tool', tool_name: 'Write', started_at: 2 }),
        ],
        prompt,
      ),
    ]);

    expect(graph.activities.find((a) => a.id === PROMPT_NODE_ID)?.isStart).toBe(true);
    expect(graph.edges).toContainEqual({
      from: PROMPT_NODE_ID,
      to: 'Read',
      count: 1,
    });
  });

  it('ignores file edits and maps shell spans to Shell', () => {
    const graph = buildProcessGraph([
      run([
        call({ id: '1', kind: 'file', tool_name: '/proj/a.ts', started_at: 1 }),
        call({ id: '2', kind: 'shell', tool_name: 'ls -la', started_at: 2 }),
        call({ id: '3', kind: 'agent_tool', tool_name: 'Read', started_at: 3 }),
      ]),
    ]);

    expect(graph.activities.map((a) => a.id)).toEqual([SHELL_NODE_ID, 'Read']);
    expect(graph.edges[0]).toMatchObject({ from: SHELL_NODE_ID, to: 'Read', count: 1 });
  });

  it('shows skills with their name and canonical agent tool labels', () => {
    expect(
      processActivityForSpan(
        call({
          id: '1',
          kind: 'skill',
          tool_name: 'standup',
          started_at: 1,
        }),
      ),
    ).toMatchObject({
      id: 'skill:standup',
      label: 'standup',
      isSkill: true,
    });

    expect(
      processActivityForSpan(
        call({ id: '2', kind: 'agent_tool', tool_name: 'read_file', started_at: 2 }),
      ),
    ).toMatchObject({ id: 'Read', label: 'Read' });
  });

  it('counts errors per activity node', () => {
    const graph = buildProcessGraph([
      run([
        call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1, status: 'error' }),
        call({ id: '2', kind: 'agent_tool', tool_name: 'Read', started_at: 2, status: 'ok' }),
        call({ id: '3', kind: 'agent_tool', tool_name: 'Write', started_at: 3, status: 'error' }),
      ]),
    ]);

    expect(graph.nodeErrorCounts.Read).toBe(1);
    expect(graph.nodeErrorCounts.Write).toBe(1);
  });

  it('handles large traces quickly', () => {
    const spans: ToolCallRecord[] = [];
    for (let i = 0; i < 700; i++) {
      spans.push(
        call({
          id: `s-${i}`,
          kind: 'agent_tool',
          tool_name: i % 2 === 0 ? 'Read' : 'Write',
          started_at: i + 1,
        }),
      );
    }
    const start = performance.now();
    const graph = buildProcessGraph([
      run(spans, call({ id: 'p', kind: 'prompt', tool_name: 'go', started_at: 0 })),
    ]);
    const ms = performance.now() - start;
    expect(graph.activities.map((a) => a.id).sort()).toEqual([
      PROMPT_NODE_ID,
      'Read',
      'Write',
    ]);
    expect(ms).toBeLessThan(100);
  });
});

describe('toMermaidFlowchart', () => {
  const colors: MermaidClassColors = {
    startFill: '#34d399',
    startText: '#0f1120',
    startStroke: '#34d399',
    toolFill: '#818cf8',
    toolText: '#0f1120',
    toolStroke: '#a5b4fc',
    skillFill: '#1a1540',
    skillText: '#818cf8',
    skillStroke: '#1e2036',
    errorFill: '#2d1215',
    errorText: '#f87171',
    errorStroke: '#1e2036',
    edge: '#818cf8',
    edgeLabelBg: '#0f1120',
    edgeLabelText: '#f1f5f9',
  };

  it('emits a top-down flowchart with node classes', () => {
    const graph = buildProcessGraph([
      run(
        [
          call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1 }),
          call({ id: '2', kind: 'agent_tool', tool_name: 'Write', started_at: 2 }),
        ],
        call({ id: 'p', kind: 'prompt', tool_name: 'hi', started_at: 0 }),
      ),
    ]);
    const mermaid = toMermaidFlowchart(graph, colors);
    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).toContain('Prompt');
    expect(mermaid).toContain('Read');
    expect(mermaid).toContain('Write');
    expect(mermaid).toContain('classDef tool');
    expect(mermaid).not.toContain('fill:"#');
    expect(mermaid).toContain('n0((Prompt 1))');
    expect(mermaid).toContain('-->|1|');
  });
});
