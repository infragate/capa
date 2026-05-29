import { describe, it, expect } from 'bun:test';
import {
  applyDefaultsToSchema,
  buildCallToolErrorPayload,
  buildSetupToolsPayload,
  buildToolSignature,
  mergeDefaults,
} from '../mcp-handler';
import {
  getQualifiedToolName,
  normalizeToolName,
} from '../../types/capabilities';
import type { Tool } from '../../types/capabilities';

describe('applyDefaultsToSchema', () => {
  it('should remove defaulted keys from required array', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['name', 'limit'],
    };

    applyDefaultsToSchema(schema, { limit: 25 });

    expect(schema.required).toEqual(['name']);
  });

  it('should annotate properties with default values', () => {
    const schema: any = {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['limit', 'offset'],
    };

    applyDefaultsToSchema(schema, { limit: 25, offset: 0 });

    expect(schema.properties.limit.default).toBe(25);
    expect(schema.properties.offset.default).toBe(0);
  });

  it('should handle empty defaults', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    };

    applyDefaultsToSchema(schema, {});

    expect(schema.required).toEqual(['name']);
    expect((schema.properties.name as any).default).toBeUndefined();
  });

  it('should handle schema without required array', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    };

    applyDefaultsToSchema(schema, { limit: 10 });

    expect((schema.properties.limit as any).default).toBe(10);
  });

  it('should ignore defaults for non-existent properties', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    };

    applyDefaultsToSchema(schema, { nonExistent: 'value' });

    expect(schema.required).toEqual(['name']);
    expect((schema.properties as any).nonExistent).toBeUndefined();
  });

  it('should handle string default values', () => {
    const schema = {
      type: 'object',
      properties: {
        format: { type: 'string' },
      },
      required: ['format'],
    };

    applyDefaultsToSchema(schema, { format: 'json' });

    expect(schema.required).toEqual([]);
    expect((schema.properties.format as any).default).toBe('json');
  });

  it('should handle boolean default values', () => {
    const schema = {
      type: 'object',
      properties: {
        verbose: { type: 'boolean' },
      },
      required: ['verbose'],
    };

    applyDefaultsToSchema(schema, { verbose: false });

    expect(schema.required).toEqual([]);
    expect((schema.properties.verbose as any).default).toBe(false);
  });
});

describe('mergeDefaults', () => {
  it('should return args when no defaults', () => {
    const args = { name: 'test' };
    const result = mergeDefaults(undefined, args);

    expect(result).toEqual({ name: 'test' });
  });

  it('should merge defaults with args', () => {
    const defaults = { limit: 25, offset: 0 };
    const args = { name: 'test' };
    const result = mergeDefaults(defaults, args);

    expect(result).toEqual({ name: 'test', limit: 25, offset: 0 });
  });

  it('should let caller args override defaults', () => {
    const defaults = { limit: 25 };
    const args = { limit: 50 };
    const result = mergeDefaults(defaults, args);

    expect(result).toEqual({ limit: 50 });
  });

  it('should handle empty args with defaults', () => {
    const defaults = { limit: 25, offset: 0 };
    const result = mergeDefaults(defaults, {});

    expect(result).toEqual({ limit: 25, offset: 0 });
  });

  it('should handle empty defaults', () => {
    const defaults = {};
    const args = { name: 'test' };
    const result = mergeDefaults(defaults, args);

    expect(result).toEqual({ name: 'test' });
  });
});

describe('normalizeToolName', () => {
  it('should replace dots with underscores', () => {
    expect(normalizeToolName('brave.search')).toBe('brave_search');
  });

  it('should replace multiple dots', () => {
    expect(normalizeToolName('a.b.c')).toBe('a_b_c');
  });

  it('should leave names without dots unchanged', () => {
    expect(normalizeToolName('my_tool')).toBe('my_tool');
  });

  it('should handle names with both dots and underscores', () => {
    expect(normalizeToolName('server.web_search')).toBe('server_web_search');
  });

  it('should handle empty string', () => {
    expect(normalizeToolName('')).toBe('');
  });
});

describe('tool name normalization (dot/underscore fallback)', () => {
  const mcpTool: Tool = {
    id: 'search',
    type: 'mcp',
    def: { server: '@brave', tool: 'brave_web_search' },
  };

  const commandTool: Tool = {
    id: 'run_tests',
    type: 'command',
    def: { run: { cmd: 'npm test' } },
  };

  it('exact match should work for MCP tools', () => {
    const qualifiedName = getQualifiedToolName(mcpTool);
    expect(qualifiedName).toBe('brave.search');
  });

  it('normalized match should equate dot and underscore versions', () => {
    const qualifiedName = getQualifiedToolName(mcpTool);
    const clientSentName = 'brave_search';

    expect(normalizeToolName(qualifiedName)).toBe(normalizeToolName(clientSentName));
  });

  it('ungrouped command tools should not be affected by normalization', () => {
    const qualifiedName = getQualifiedToolName(commandTool);
    expect(qualifiedName).toBe('run_tests');
    expect(normalizeToolName(qualifiedName)).toBe('run_tests');
  });

  it('exact match should take priority over normalized match', () => {
    const tools: Tool[] = [
      mcpTool,
      { id: 'brave_search', type: 'command', def: { run: { cmd: 'echo' } } },
    ];

    const searchName = 'brave_search';
    const exact = tools.find((t) => getQualifiedToolName(t) === searchName);
    expect(exact).toBeDefined();
    expect(exact!.type).toBe('command');
  });

  it('fallback normalized match should find MCP tools when exact fails', () => {
    const tools: Tool[] = [mcpTool];
    const clientSentName = 'brave_search';

    const exact = tools.find((t) => getQualifiedToolName(t) === clientSentName);
    expect(exact).toBeUndefined();

    const normalized = normalizeToolName(clientSentName);
    const fallback = tools.find(
      (t) => normalizeToolName(getQualifiedToolName(t)) === normalized
    );
    expect(fallback).toBeDefined();
    expect(fallback!.id).toBe('search');
  });
});

describe('getQualifiedToolName with grouped command tools', () => {
  it('should prefix grouped command tools with group name', () => {
    const tool: Tool = {
      id: 'commit',
      type: 'command',
      def: { run: { cmd: 'git commit' } },
      group: 'git',
    };
    expect(getQualifiedToolName(tool)).toBe('git.commit');
  });

  it('should not prefix ungrouped command tools', () => {
    const tool: Tool = {
      id: 'run_tests',
      type: 'command',
      def: { run: { cmd: 'npm test' } },
    };
    expect(getQualifiedToolName(tool)).toBe('run_tests');
  });

  it('should handle MCP tools unchanged', () => {
    const tool: Tool = {
      id: 'search',
      type: 'mcp',
      def: { server: '@brave', tool: 'brave_web_search' },
    };
    expect(getQualifiedToolName(tool)).toBe('brave.search');
  });

  it('grouped command tools should work with dot/underscore normalization', () => {
    const tool: Tool = {
      id: 'commit',
      type: 'command',
      def: { run: { cmd: 'git commit' } },
      group: 'git',
    };
    const qualifiedName = getQualifiedToolName(tool);
    expect(qualifiedName).toBe('git.commit');
    expect(normalizeToolName(qualifiedName)).toBe('git_commit');
    expect(normalizeToolName('git_commit')).toBe('git_commit');
  });

  it('fallback normalized match should find grouped command tools', () => {
    const tool: Tool = {
      id: 'commit',
      type: 'command',
      def: { run: { cmd: 'git commit' } },
      group: 'git',
    };
    const tools: Tool[] = [tool];
    const clientSentName = 'git_commit';

    const exact = tools.find((t) => getQualifiedToolName(t) === clientSentName);
    expect(exact).toBeUndefined();

    const normalized = normalizeToolName(clientSentName);
    const fallback = tools.find(
      (t) => normalizeToolName(getQualifiedToolName(t)) === normalized
    );
    expect(fallback).toBeDefined();
    expect(fallback!.id).toBe('commit');
  });
});

// ─── setup_tools response shape ───────────────────────────────────────────────
//
// `setup_tools` accumulates skills across calls, so historically the response
// re-emitted every tool's full input schema on every call — that bloats the
// agent's context window. The new contract: return signature strings only and
// reserve the full schema for the `call_tool` error response when the agent
// has demonstrably called wrong. These tests pin the new format.

describe('buildToolSignature', () => {
  it('renders empty arg list when there is no input schema', () => {
    expect(
      buildToolSignature({ name: 'ping', inputSchema: undefined as any })
    ).toBe('ping()');
  });

  it('renders empty arg list when schema has no properties', () => {
    expect(
      buildToolSignature({
        name: 'ping',
        inputSchema: { type: 'object' as const },
      })
    ).toBe('ping()');
  });

  it('renders required-only properties in their declared required-order', () => {
    expect(
      buildToolSignature({
        name: 'git.commit',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message: { type: 'string' },
            author: { type: 'string' },
          },
          required: ['message', 'author'],
        },
      })
    ).toBe('git.commit(message, author)');
  });

  it('marks optional properties with `?` and lists required first', () => {
    expect(
      buildToolSignature({
        name: 'github.create_issue',
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array' },
            assignees: { type: 'array' },
          },
          required: ['title', 'body'],
        },
      })
    ).toBe('github.create_issue(title, body, labels?, assignees?)');
  });

  it('renders all-optional schemas with every property marked `?`', () => {
    expect(
      buildToolSignature({
        name: 'fs.list',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' },
            depth: { type: 'number' },
          },
        },
      })
    ).toBe('fs.list(path?, depth?)');
  });

  it('preserves the `required` array ordering, not the property-declaration ordering', () => {
    // If the schema declares properties in {a, b} but requires [b, a], the
    // signature must put `b` first — agents will read the order as a hint at
    // positional/sensible call shape.
    expect(
      buildToolSignature({
        name: 't',
        inputSchema: {
          type: 'object' as const,
          properties: {
            a: { type: 'string' },
            b: { type: 'string' },
          },
          required: ['b', 'a'],
        },
      })
    ).toBe('t(b, a)');
  });

  it('ignores entries in `required` that have no matching property', () => {
    // Defensive: some schemas list `required` keys that no longer exist in
    // `properties` after edits. We must not emit phantom args.
    expect(
      buildToolSignature({
        name: 't',
        inputSchema: {
          type: 'object' as const,
          properties: { real: { type: 'string' } },
          required: ['real', 'ghost'],
        },
      })
    ).toBe('t(real)');
  });
});

describe('buildSetupToolsPayload', () => {
  it('returns a slim JSON payload (no schemas) with skills, activeSkills, and hint', () => {
    const payload = buildSetupToolsPayload(
      ['skill-a'],
      ['skill-a', 'skill-b'],
      ['tool_a(x)', 'tool_b(y?, z?)']
    );
    expect(payload.success).toBe(true);
    expect(payload.skills).toEqual(['skill-a']);
    expect(payload.activeSkills).toEqual(['skill-a', 'skill-b']);
    expect(payload.tools).toEqual(['tool_a(x)', 'tool_b(y?, z?)']);
    expect(payload.message).toContain('1 skill(s)');
    expect(payload.message).toContain('2 tool(s)');
    expect(payload.hint).toMatch(/call_tool/);
    expect(payload.hint).toMatch(/schema/);
  });

  it('distinguishes between the skills requested in this call and the merged active set', () => {
    // The agent needs to be able to tell what was already active without
    // diffing prior responses — drives whether to skip a redundant call.
    const payload = buildSetupToolsPayload(
      ['skill-b'],
      ['skill-a', 'skill-b'],
      []
    );
    expect(payload.skills).toEqual(['skill-b']);
    expect(payload.activeSkills).toEqual(['skill-a', 'skill-b']);
  });

  it('never includes a full inputSchema field on a tool entry', () => {
    // Regression guard: the slim format MUST stay slim. If a future refactor
    // tries to add schemas back, this test fails loudly.
    const payload = buildSetupToolsPayload(['s'], ['s'], ['tool_a(x)']);
    for (const entry of payload.tools) {
      expect(typeof entry).toBe('string');
    }
  });
});

describe('buildCallToolErrorPayload', () => {
  it('omits tool / schema / hint when no tool context is provided', () => {
    const payload = buildCallToolErrorPayload('Something went wrong');
    expect(payload).toEqual({ error: 'Something went wrong' });
  });

  it('attaches name, schema, and a retry hint when a tool is provided', () => {
    const payload = buildCallToolErrorPayload('Missing required arg: title', {
      tool: {
        name: 'github.create_issue',
        description: 'Create an issue',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' }, body: { type: 'string' } },
          required: ['title', 'body'],
        },
      },
    });
    expect(payload.error).toBe('Missing required arg: title');
    expect(payload.tool).toBe('github.create_issue');
    expect(payload.schema).toEqual({
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title', 'body'],
    });
    expect(payload.hint).toMatch(/call_tool/);
    expect(payload.hint).toMatch(/github\.create_issue/);
  });
});
