import { describe, it, expect } from 'bun:test';
import type { Tool } from '../capabilities';
import { resolveSubagentToolRef, resolveSubagentToolRefs } from '../capabilities';

const tools: Tool[] = [
  // MCP tool — qualified name "dbx.sql_read_only"
  { id: 'sql_read_only', type: 'mcp', def: { server: '@dbx', tool: 'execute_sql_read_only' } },
  // Grouped command tool — qualified name "git.commit"
  { id: 'commit', type: 'command', group: 'git', def: { run: { cmd: 'git', args: [] } } as any },
  // Ungrouped command tool — qualified name "lint"
  { id: 'lint', type: 'command', def: { run: { cmd: 'eslint', args: [] } } as any },
];

describe('resolveSubagentToolRef', () => {
  it('resolves an MCP tool by bare local id', () => {
    expect(resolveSubagentToolRef('sql_read_only', tools)?.id).toBe('sql_read_only');
  });

  it('resolves an MCP tool by qualified name', () => {
    expect(resolveSubagentToolRef('dbx.sql_read_only', tools)?.id).toBe('sql_read_only');
  });

  it('resolves an MCP tool by @qualified name (requires-style)', () => {
    expect(resolveSubagentToolRef('@dbx.sql_read_only', tools)?.id).toBe('sql_read_only');
  });

  it('resolves a grouped command tool in all three forms', () => {
    expect(resolveSubagentToolRef('commit', tools)?.id).toBe('commit');
    expect(resolveSubagentToolRef('git.commit', tools)?.id).toBe('commit');
    expect(resolveSubagentToolRef('@git.commit', tools)?.id).toBe('commit');
  });

  it('resolves an ungrouped command tool by bare id', () => {
    expect(resolveSubagentToolRef('lint', tools)?.id).toBe('lint');
  });

  it('returns undefined for an unknown ref', () => {
    expect(resolveSubagentToolRef('does_not_exist', tools)).toBeUndefined();
    expect(resolveSubagentToolRef('@dbx.does_not_exist', tools)).toBeUndefined();
    expect(resolveSubagentToolRef('unknown.tool', tools)).toBeUndefined();
  });
});

describe('resolveSubagentToolRefs (whole-server refs)', () => {
  const serverTools: Tool[] = [
    ...tools,
    { id: 'sql_write', type: 'mcp', def: { server: '@dbx', tool: 'execute_sql_write' } },
  ];

  it('expands a bare server ref to every tool on that server', () => {
    expect(resolveSubagentToolRefs('@dbx', serverTools).map((t) => t.id)).toEqual([
      'sql_read_only',
      'sql_write',
    ]);
  });

  it('expands a wildcard server ref', () => {
    expect(resolveSubagentToolRefs('dbx.*', serverTools).map((t) => t.id)).toEqual([
      'sql_read_only',
      'sql_write',
    ]);
  });

  it('still resolves a single tool ref to exactly that tool', () => {
    expect(resolveSubagentToolRefs('@dbx.sql_read_only', serverTools).map((t) => t.id)).toEqual([
      'sql_read_only',
    ]);
  });

  it('returns nothing for an unknown ref', () => {
    expect(resolveSubagentToolRefs('nope.*', serverTools)).toEqual([]);
    expect(resolveSubagentToolRefs('does_not_exist', serverTools)).toEqual([]);
  });
});
