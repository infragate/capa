import { describe, it, expect } from 'bun:test';
import { slugify, parseInlineArgs, resolveArgs, coerceValue } from '../sh';
import type { ShellCommand } from '../sh';

function makeCommand(overrides: Partial<ShellCommand> = {}): ShellCommand {
  return {
    id: 'test-tool',
    slug: 'test-tool',
    type: 'command',
    description: '',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    argSlugs: new Map(),
    ...overrides,
  };
}

describe('parseInlineArgs', () => {
  it('should parse key-value pairs', () => {
    const result = parseInlineArgs(['--name', 'Alice', '--age', '30']);
    expect(result).toEqual({ name: 'Alice', age: '30' });
  });

  it('should treat flags without values as boolean true', () => {
    const result = parseInlineArgs(['--verbose']);
    expect(result).toEqual({ verbose: 'true' });
  });

  it('should handle mixed flags and key-value pairs', () => {
    const result = parseInlineArgs(['--name', 'Alice', '--verbose', '--count', '5']);
    expect(result).toEqual({ name: 'Alice', verbose: 'true', count: '5' });
  });

  it('should return empty object for no args', () => {
    const result = parseInlineArgs([]);
    expect(result).toEqual({});
  });

  it('should ignore tokens not starting with --', () => {
    const result = parseInlineArgs(['ignored', '--name', 'Alice']);
    expect(result).toEqual({ name: 'Alice' });
  });
});

describe('resolveArgs', () => {
  it('should resolve slugified names to original names', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['page-size', 'pageSize']]),
      inputSchema: {
        type: 'object',
        properties: { pageSize: { type: 'number' } },
        required: ['pageSize'],
      },
    });

    const result = resolveArgs(cmd, { 'page-size': '25' });
    expect(result).toEqual({ pageSize: 25 });
  });

  it('should convert number types', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['limit', 'limit']]),
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
      },
    });

    const result = resolveArgs(cmd, { limit: '50' });
    expect(result).toEqual({ limit: 50 });
  });

  it('should convert boolean types', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['verbose', 'verbose']]),
      inputSchema: {
        type: 'object',
        properties: { verbose: { type: 'boolean' } },
      },
    });

    expect(resolveArgs(cmd, { verbose: 'true' })).toEqual({ verbose: true });
    expect(resolveArgs(cmd, { verbose: 'false' })).toEqual({ verbose: false });
    expect(resolveArgs(cmd, { verbose: '0' })).toEqual({ verbose: false });
  });

  it('should keep string types as-is', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['name', 'name']]),
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
    });

    const result = resolveArgs(cmd, { name: 'Alice' });
    expect(result).toEqual({ name: 'Alice' });
  });

  it('should pass through args not in slugs map', () => {
    const cmd = makeCommand();
    const result = resolveArgs(cmd, { unknown: 'value' });
    expect(result).toEqual({ unknown: 'value' });
  });
});

describe('coerceValue', () => {
  it('should coerce number type', () => {
    expect(coerceValue('42', { type: 'number' })).toBe(42);
    expect(coerceValue('3.14', { type: 'number' })).toBe(3.14);
    expect(coerceValue('-10', { type: 'number' })).toBe(-10);
  });

  it('should coerce integer type', () => {
    expect(coerceValue('42', { type: 'integer' })).toBe(42);
    expect(coerceValue('0', { type: 'integer' })).toBe(0);
  });

  it('should return original string for non-numeric number type', () => {
    expect(coerceValue('abc', { type: 'number' })).toBe('abc');
  });

  it('should coerce boolean type', () => {
    expect(coerceValue('true', { type: 'boolean' })).toBe(true);
    expect(coerceValue('false', { type: 'boolean' })).toBe(false);
    expect(coerceValue('0', { type: 'boolean' })).toBe(false);
    expect(coerceValue('1', { type: 'boolean' })).toBe(true);
  });

  it('should coerce array of strings from comma-separated', () => {
    expect(coerceValue('a,b,c', { type: 'array', items: { type: 'string' } }))
      .toEqual(['a', 'b', 'c']);
  });

  it('should trim whitespace in comma-separated arrays', () => {
    expect(coerceValue('a, b, c', { type: 'array', items: { type: 'string' } }))
      .toEqual(['a', 'b', 'c']);
  });

  it('should coerce array of numbers from comma-separated', () => {
    expect(coerceValue('1,2,3', { type: 'array', items: { type: 'number' } }))
      .toEqual([1, 2, 3]);
  });

  it('should coerce array of integers from comma-separated', () => {
    expect(coerceValue('10,20,30', { type: 'array', items: { type: 'integer' } }))
      .toEqual([10, 20, 30]);
  });

  it('should coerce array from JSON syntax', () => {
    expect(coerceValue('[1,2,3]', { type: 'array', items: { type: 'number' } }))
      .toEqual([1, 2, 3]);
  });

  it('should coerce array of objects from JSON syntax', () => {
    expect(coerceValue('[{"a":1},{"b":2}]', { type: 'array', items: { type: 'object' } }))
      .toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('should coerce array without items schema as strings', () => {
    expect(coerceValue('x,y,z', { type: 'array' }))
      .toEqual(['x', 'y', 'z']);
  });

  it('should coerce object type via JSON parse', () => {
    expect(coerceValue('{"key":"value"}', { type: 'object' }))
      .toEqual({ key: 'value' });
  });

  it('should return raw string for invalid object JSON', () => {
    expect(coerceValue('not-json', { type: 'object' })).toBe('not-json');
  });

  it('should keep string type as-is', () => {
    expect(coerceValue('hello', { type: 'string' })).toBe('hello');
    expect(coerceValue('42', { type: 'string' })).toBe('42');
  });

  it('should infer types when no schema is provided', () => {
    expect(coerceValue('hello', undefined)).toBe('hello');
  });

  it('should infer types when schema has no type field', () => {
    expect(coerceValue('true', {})).toBe(true);
    expect(coerceValue('false', {})).toBe(false);
    expect(coerceValue('42', {})).toBe(42);
    expect(coerceValue('hello', {})).toBe('hello');
    expect(coerceValue('{"a":1}', {})).toEqual({ a: 1 });
    expect(coerceValue('[1,2]', {})).toEqual([1, 2]);
  });
});

describe('resolveArgs with type coercion', () => {
  it('should coerce integer parameters', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['limit', 'limit']]),
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer' } },
      },
    });
    expect(resolveArgs(cmd, { limit: '5' })).toEqual({ limit: 5 });
  });

  it('should coerce array parameters from comma-separated values', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['tags', 'tags']]),
      inputSchema: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
      },
    });
    expect(resolveArgs(cmd, { tags: 'a,b,c' })).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('should coerce object parameters from JSON strings', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['config', 'config']]),
      inputSchema: {
        type: 'object',
        properties: { config: { type: 'object' } },
      },
    });
    expect(resolveArgs(cmd, { config: '{"key":"val"}' })).toEqual({ config: { key: 'val' } });
  });
});

describe('slugify', () => {
  it('should convert camelCase to kebab-case', () => {
    expect(slugify('pageSize')).toBe('page-size');
    expect(slugify('myLongVariableName')).toBe('my-long-variable-name');
  });

  it('should convert underscores to hyphens', () => {
    expect(slugify('page_size')).toBe('page-size');
  });

  it('should handle already kebab-case names', () => {
    expect(slugify('page-size')).toBe('page-size');
  });

  it('should handle PascalCase', () => {
    expect(slugify('PageSize')).toBe('page-size');
  });

  it('should collapse multiple hyphens', () => {
    expect(slugify('a--b')).toBe('a-b');
  });

  it('should strip leading/trailing hyphens', () => {
    expect(slugify('-name-')).toBe('name');
  });
});

describe('default argument merging in CLI context', () => {
  it('should use defaults when args are not provided', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['limit', 'limit'], ['offset', 'offset']]),
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 25 },
          offset: { type: 'number', default: 0 },
        },
        required: [],
      },
      defaults: { limit: 25, offset: 0 },
    });

    const rawArgs = parseInlineArgs([]);
    const resolved = resolveArgs(cmd, rawArgs);

    if (cmd.defaults) {
      for (const [key, value] of Object.entries(cmd.defaults)) {
        if (!(key in resolved)) {
          resolved[key] = value;
        }
      }
    }

    expect(resolved).toEqual({ limit: 25, offset: 0 });
  });

  it('should let user-provided args override defaults', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['limit', 'limit'], ['offset', 'offset']]),
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 25 },
          offset: { type: 'number', default: 0 },
        },
        required: [],
      },
      defaults: { limit: 25, offset: 0 },
    });

    const rawArgs = parseInlineArgs(['--limit', '100']);
    const resolved = resolveArgs(cmd, rawArgs);

    if (cmd.defaults) {
      for (const [key, value] of Object.entries(cmd.defaults)) {
        if (!(key in resolved)) {
          resolved[key] = value;
        }
      }
    }

    expect(resolved).toEqual({ limit: 100, offset: 0 });
  });

  it('should work with no defaults defined', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['name', 'name']]),
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    });

    const rawArgs = parseInlineArgs(['--name', 'test']);
    const resolved = resolveArgs(cmd, rawArgs);

    if (cmd.defaults) {
      for (const [key, value] of Object.entries(cmd.defaults)) {
        if (!(key in resolved)) {
          resolved[key] = value;
        }
      }
    }

    expect(resolved).toEqual({ name: 'test' });
  });

  it('should not count defaulted args as missing required', () => {
    const cmd = makeCommand({
      argSlugs: new Map([['limit', 'limit']]),
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 25 },
        },
        required: [],
      },
      defaults: { limit: 25 },
    });

    const rawArgs = parseInlineArgs([]);
    const resolved = resolveArgs(cmd, rawArgs);

    if (cmd.defaults) {
      for (const [key, value] of Object.entries(cmd.defaults)) {
        if (!(key in resolved)) {
          resolved[key] = value;
        }
      }
    }

    const required: string[] = cmd.inputSchema?.required || [];
    const missingRequired = required.filter(
      (r: string) => !(slugify(r) in rawArgs) && !(r in rawArgs) && !(r in (cmd.defaults || {}))
    );

    expect(missingRequired).toEqual([]);
    expect(resolved.limit).toBe(25);
  });
});
