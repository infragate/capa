import { describe, it, expect } from 'bun:test';
import { applyDefaultsToSchema, mergeDefaults } from '../mcp-handler';

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
