import { describe, it, expect } from 'bun:test';
import { applyDefaultsToSchema, mergeDefaults } from '../mcp-handler';
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
