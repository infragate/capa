import { describe, expect, it } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import type { ActivityRun } from './groupActivityRuns';
import {
  PROMPT_NODE_ID,
  SHELL_NODE_ID,
  buildProcessGraph,
  graphToMarkdown,
  isCapaMetaToolWrapperSpan,
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

  it('treats MCP:search as a capa meta-tool wrapper', () => {
    expect(
      isCapaMetaToolWrapperSpan(
        call({ id: 's1', kind: 'agent_tool', tool_name: 'MCP:search', started_at: 1 }),
      ),
    ).toBe(true);
    expect(
      isCapaMetaToolWrapperSpan(
        call({ id: 's2', kind: 'agent_mcp', tool_name: 'search', started_at: 2 }),
      ),
    ).toBe(true);
    // A provider's own tool that happens to be called "search" is not ours.
    expect(
      isCapaMetaToolWrapperSpan(
        call({ id: 's3', kind: 'agent_tool', tool_name: 'search', started_at: 3 }),
      ),
    ).toBe(false);
  });

  it('keeps a real tool named "search" on the map', () => {
    const prompt = call({ id: 'p', kind: 'prompt', tool_name: 'find it', started_at: 0 });
    const graph = buildProcessGraph([
      run(
        [
          call({
            id: '1',
            kind: 'search',
            tool_name: 'search',
            meta_tool: 'search',
            started_at: 1,
          }),
          call({
            id: '2',
            kind: 'call_tool',
            tool_name: 'brave.search',
            meta_tool: 'call_tool',
            started_at: 2,
          }),
          call({ id: '3', kind: 'tool', tool_name: 'search', started_at: 3 }),
        ],
        prompt,
      ),
    ]);

    const ids = graph.activities.map((a) => a.id);
    // capa's own search span is dropped; both real tools survive.
    expect(ids).toContain('capa:brave.search');
    expect(ids).toContain('capa:search');
    expect(ids).not.toContain('search');
  });

  it('dedupes capa MCP meta-tool wrappers (MCP:call_tool, agent_mcp, setup_tools)', () => {
    expect(
      isCapaMetaToolWrapperSpan(
        call({ id: 'w1', kind: 'agent_tool', tool_name: 'MCP:call_tool', started_at: 1 }),
      ),
    ).toBe(true);
    expect(
      isCapaMetaToolWrapperSpan(
        call({ id: 'w2', kind: 'agent_mcp', tool_name: 'call_tool', started_at: 2 }),
      ),
    ).toBe(true);

    const prompt = call({
      id: 'p',
      kind: 'prompt',
      tool_name: 'check metrics',
      started_at: 0,
    });
    const graph = buildProcessGraph([
      run(
        [
          call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1 }),
          call({
            id: '2',
            kind: 'call_tool',
            tool_name: 'grafana.query-prometheus',
            meta_tool: 'call_tool',
            started_at: 2,
          }),
          call({ id: '3', kind: 'agent_mcp', tool_name: 'call_tool', started_at: 3 }),
          call({ id: '4', kind: 'agent_tool', tool_name: 'MCP:call_tool', started_at: 4 }),
          call({
            id: '5',
            kind: 'setup_tools',
            tool_name: 'setup_tools',
            meta_tool: 'setup_tools',
            started_at: 5,
          }),
          call({ id: '6', kind: 'agent_mcp', tool_name: 'setup_tools', started_at: 6 }),
          call({ id: '7', kind: 'agent_tool', tool_name: 'MCP:setup_tools', started_at: 7 }),
          call({ id: '8', kind: 'tool', tool_name: 'pagerduty.get_alerts', started_at: 8 }),
          call({ id: '9', kind: 'agent_tool', tool_name: 'Grep', started_at: 9 }),
        ],
        prompt,
      ),
    ]);

    const ids = graph.activities.map((a) => a.id);
    expect(ids).toContain('capa:grafana.query-prometheus');
    expect(ids).toContain('capa:pagerduty.get_alerts');
    expect(ids).not.toContain('call_tool');
    expect(ids).not.toContain('MCP:call_tool');
    expect(ids).not.toContain('setup_tools');
    expect(ids).not.toContain('MCP:setup_tools');
    expect(graph.edges).toContainEqual({
      from: 'Read',
      to: 'capa:grafana.query-prometheus',
      count: 1,
    });
    expect(graph.edges).toContainEqual({
      from: 'capa:pagerduty.get_alerts',
      to: 'Grep',
      count: 1,
    });
    expect(graph.edges.some((edge) => edge.from.includes('call_tool'))).toBe(false);
  });

  it('includes provider-native MCP tools that do not go through capa', () => {
    const graph = buildProcessGraph([
      run([
        call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1 }),
        call({ id: '2', kind: 'agent_mcp', tool_name: 'brave_search', started_at: 2 }),
        call({ id: '3', kind: 'agent_tool', tool_name: 'Write', started_at: 3 }),
      ]),
    ]);

    expect(graph.activities.map((a) => a.id)).toContain('brave_search');
    expect(graph.edges).toContainEqual({ from: 'Read', to: 'brave_search', count: 1 });
    expect(graph.edges).toContainEqual({ from: 'brave_search', to: 'Write', count: 1 });
  });

  it('normalizes Cursor MCP:tool_name to the same node as agent_mcp', () => {
    const graph = buildProcessGraph([
      run([
        call({ id: '1', kind: 'agent_tool', tool_name: 'MCP:brave_search', started_at: 1 }),
        call({ id: '2', kind: 'agent_mcp', tool_name: 'brave_search', started_at: 2 }),
      ]),
    ]);

    expect(graph.activities.filter((a) => a.id === 'brave_search')).toHaveLength(1);
    expect(graph.nodeCounts.brave_search).toBe(2);
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

  it('exports markdown with a mermaid block when provided', () => {
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
    const md = graphToMarkdown(graph, mermaid);
    expect(md).toContain('# Process analysis');
    expect(md).toContain('```mermaid');
    expect(md).toContain('flowchart TD');
  });

  it('exports markdown activity list when mermaid is unavailable', () => {
    const graph = buildProcessGraph([
      run([call({ id: '1', kind: 'agent_tool', tool_name: 'Read', started_at: 1 })], null),
    ]);
    const md = graphToMarkdown(graph, null);
    expect(md).toContain('- Read');
    expect(md).not.toContain('```mermaid');
  });
});
