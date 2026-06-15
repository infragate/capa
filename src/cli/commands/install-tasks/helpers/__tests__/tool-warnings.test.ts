import { describe, it, expect } from 'bun:test';
import type { Capabilities } from '../../../../../types/capabilities';
import { collectSubagentRefWarnings } from '../tool-warnings';

const baseCapabilities = (): Capabilities => ({
  providers: ['claude-code'],
  skills: [
    { id: 'general-data-analysis', type: 'local', def: { path: './skills/general-data-analysis' } },
    { id: 'general-databricks-cli', type: 'local', def: { path: './skills/general-databricks-cli' } },
  ],
  servers: [],
  tools: [
    { id: 'sql_read_only', type: 'mcp', def: { server: '@dbx', tool: 'execute_sql_read_only' } },
    { id: 'poll_sql_result', type: 'mcp', def: { server: '@dbx', tool: 'poll_sql_result' } },
  ],
});

describe('collectSubagentRefWarnings', () => {
  it('returns no warnings when every reference resolves', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      {
        id: 'data-analyst',
        description: '',
        skills: ['general-data-analysis', 'general-databricks-cli'],
        tools: ['sql_read_only', 'poll_sql_result'],
      },
    ];
    expect(collectSubagentRefWarnings(cap)).toEqual([]);
  });

  it('warns once per unknown skill id, naming the subagent', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      {
        id: 'data-analyst',
        description: '',
        skills: ['general-data-analysis', 'general-data-analyiss'],
        tools: [],
      },
    ];
    const warnings = collectSubagentRefWarnings(cap);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"data-analyst"');
    expect(warnings[0]).toContain('"general-data-analyiss"');
    expect(warnings[0]).toContain('unknown skill');
  });

  it('warns once per unknown tool id, naming the subagent', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      {
        id: 'data-analyst',
        description: '',
        skills: [],
        tools: ['sql_read_only', 'slq_read_only'],
      },
    ];
    const warnings = collectSubagentRefWarnings(cap);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"data-analyst"');
    expect(warnings[0]).toContain('"slq_read_only"');
    expect(warnings[0]).toContain('unknown tool');
  });

  it('emits one warning per typo across multiple subagents', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      { id: 'a1', description: '', skills: ['missing-1'], tools: ['missing-tool'] },
      { id: 'a2', description: '', skills: ['missing-2'], tools: [] },
    ];
    const warnings = collectSubagentRefWarnings(cap);
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes('"a1"') && w.includes('missing-1'))).toBe(true);
    expect(warnings.some((w) => w.includes('"a1"') && w.includes('missing-tool'))).toBe(true);
    expect(warnings.some((w) => w.includes('"a2"') && w.includes('missing-2'))).toBe(true);
  });

  it('returns an empty list when there are no subagents', () => {
    const cap = baseCapabilities();
    expect(collectSubagentRefWarnings(cap)).toEqual([]);
  });

  it('tolerates a subagent missing the optional skills/tools fields', () => {
    const cap = baseCapabilities();
    cap.subagents = [{ id: 'a', description: '' } as any];
    expect(collectSubagentRefWarnings(cap)).toEqual([]);
  });
});
