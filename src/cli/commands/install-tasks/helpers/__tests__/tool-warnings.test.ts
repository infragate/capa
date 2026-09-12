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

  it('accepts @server.tool, server.tool, and bare tool_id forms for the same tool', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      {
        id: 'data-analyst',
        description: '',
        skills: [],
        tools: ['sql_read_only', 'dbx.sql_read_only', '@dbx.sql_read_only'],
      },
    ];
    expect(collectSubagentRefWarnings(cap)).toEqual([]);
  });

  it('still flags an @-prefixed reference whose qualified name does not resolve', () => {
    const cap = baseCapabilities();
    cap.subagents = [
      {
        id: 'data-analyst',
        description: '',
        skills: [],
        tools: ['@dbx.does_not_exist'],
      },
    ];
    const warnings = collectSubagentRefWarnings(cap);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"@dbx.does_not_exist"');
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

describe('collectSubagentRefWarnings with server-exposed tools', () => {
  const caps = (servers: any[], tools: any[], subagentTools: string[]): any => ({
    providers: [],
    options: {},
    skills: [],
    servers,
    tools,
    subagents: [{ id: 'oncall', skills: [], tools: subagentTools }],
  });

  const server = (extra: Record<string, unknown> = {}): any => ({
    id: 'devtools',
    type: 'mcp',
    def: { url: 'https://x.test/mcp' },
    ...extra,
  });

  it('does not warn for a tool the server exposes at configure time', () => {
    // `devtools.list_alerts` is never in the file — it comes from the server's
    // own tools/list — so it must not be reported as a typo.
    expect(collectSubagentRefWarnings(caps([server()], [], ['@devtools.list_alerts']))).toEqual([]);
    expect(collectSubagentRefWarnings(caps([server()], [], ['@devtools']))).toEqual([]);
    expect(collectSubagentRefWarnings(caps([server()], [], ['devtools.*']))).toEqual([]);
  });

  it('still warns for a server that exposes nothing', () => {
    expect(
      collectSubagentRefWarnings(caps([server({ expose: 'none' })], [], ['@devtools.list_alerts'])),
    ).toHaveLength(1);
  });

  it('still warns once the server has a declared tool (policy off)', () => {
    // One `tools:` entry turns the whole policy off, so nothing else on that
    // server can appear — an undeclared ref is a typo again.
    const declared = {
      id: 'alerts',
      type: 'mcp',
      def: { server: '@devtools', tool: 'list_alerts' },
    };
    expect(
      collectSubagentRefWarnings(caps([server()], [declared], ['@devtools.rotate_credentials'])),
    ).toHaveLength(1);
    // The declared one still resolves normally.
    expect(collectSubagentRefWarnings(caps([server()], [declared], ['@devtools.alerts']))).toEqual([]);
  });

  it('applies except / exactly before suppressing', () => {
    const except = server({ expose: 'except', tools: ['rotate_credentials'] });
    expect(
      collectSubagentRefWarnings(caps([except], [], ['@devtools.rotate_credentials'])),
    ).toHaveLength(1);
    expect(collectSubagentRefWarnings(caps([except], [], ['@devtools.list_alerts']))).toEqual([]);

    const exactly = server({ expose: 'exactly', tools: ['list_alerts'] });
    expect(collectSubagentRefWarnings(caps([exactly], [], ['@devtools.list_alerts']))).toEqual([]);
    expect(
      collectSubagentRefWarnings(caps([exactly], [], ['@devtools.rotate_credentials'])),
    ).toHaveLength(1);
  });

  it('handles a server id that contains dots', () => {
    const dotted = server({ id: 'foo.bar' });
    expect(collectSubagentRefWarnings(caps([dotted], [], ['@foo.bar']))).toEqual([]);
    expect(collectSubagentRefWarnings(caps([dotted], [], ['foo.bar.*']))).toEqual([]);
    expect(collectSubagentRefWarnings(caps([dotted], [], ['@foo.bar.list_alerts']))).toEqual([]);
    expect(collectSubagentRefWarnings(caps([dotted], [], ['@foo.list_alerts']))).toHaveLength(1);
  });

  it('matches the sanitized id of a remote name under exactly', () => {
    // A remote tool called `a.b` is synthesized as `a_b`, which is the name a
    // sub-agent would reference.
    const exactly = server({ expose: 'exactly', tools: ['a.b'] });
    expect(collectSubagentRefWarnings(caps([exactly], [], ['@devtools.a_b']))).toEqual([]);
  });

  it('still warns for an unknown server or a plain typo', () => {
    expect(collectSubagentRefWarnings(caps([server()], [], ['@nope.thing']))).toHaveLength(1);
    expect(collectSubagentRefWarnings(caps([server()], [], ['typo_tool']))).toHaveLength(1);
  });
});
