import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  resolveVariables,
  extractVariables,
  resolveVariablesInObject,
  hasUnresolvedVariables,
  extractAllVariables,
} from '../variable-resolver';

describe('variable-resolver', () => {
  // Mock database
  const mockDb = {
    getVariable: mock((projectId: string, key: string) => {
      const variables: Record<string, string> = {
        'API_KEY': 'test-key-123',
        'BASE_URL': 'https://api.example.com',
        'PORT': '3000',
      };
      return variables[key] ?? null;
    }),
  };

  beforeEach(() => {
    mockDb.getVariable.mockClear();
  });

  describe('resolveVariables', () => {
    it('should resolve a single variable', () => {
      const input = 'The API key is ${API_KEY}';
      const result = resolveVariables(input, 'test-project', mockDb as any);
      
      expect(result).toBe('The API key is test-key-123');
    });

    it('should resolve multiple variables', () => {
      const input = 'Connect to ${BASE_URL} on port ${PORT}';
      const result = resolveVariables(input, 'test-project', mockDb as any);
      
      expect(result).toBe('Connect to https://api.example.com on port 3000');
    });

    it('should keep unresolved variables as placeholders', () => {
      const input = 'Missing variable: ${UNKNOWN_VAR}';
      const result = resolveVariables(input, 'test-project', mockDb as any);
      
      expect(result).toBe('Missing variable: ${UNKNOWN_VAR}');
    });

    it('should handle strings with no variables', () => {
      const input = 'No variables here';
      const result = resolveVariables(input, 'test-project', mockDb as any);
      
      expect(result).toBe('No variables here');
    });

    it('should handle empty strings', () => {
      const input = '';
      const result = resolveVariables(input, 'test-project', mockDb as any);
      
      expect(result).toBe('');
    });
  });

  describe('extractVariables', () => {
    it('should extract single variable', () => {
      const input = 'Value: ${API_KEY}';
      const variables = extractVariables(input);
      
      expect(variables).toEqual(['API_KEY']);
    });

    it('should extract multiple variables', () => {
      const input = '${API_KEY} and ${BASE_URL} and ${PORT}';
      const variables = extractVariables(input);
      
      expect(variables).toEqual(['API_KEY', 'BASE_URL', 'PORT']);
    });

    it('should return empty array when no variables', () => {
      const input = 'No variables here';
      const variables = extractVariables(input);
      
      expect(variables).toEqual([]);
    });

    it('should handle duplicate variables', () => {
      const input = '${API_KEY} and ${API_KEY}';
      const variables = extractVariables(input);
      
      expect(variables).toEqual(['API_KEY', 'API_KEY']);
    });
  });

  describe('resolveVariablesInObject', () => {
    it('should resolve variables in object strings', () => {
      const obj = {
        url: '${BASE_URL}/api',
        key: '${API_KEY}',
      };
      const result = resolveVariablesInObject(obj, 'test-project', mockDb as any);
      
      expect(result).toEqual({
        url: 'https://api.example.com/api',
        key: 'test-key-123',
      });
    });

    it('should resolve variables in nested objects', () => {
      const obj = {
        config: {
          api: {
            url: '${BASE_URL}',
            port: '${PORT}',
          },
        },
      };
      const result = resolveVariablesInObject(obj, 'test-project', mockDb as any);
      
      expect(result).toEqual({
        config: {
          api: {
            url: 'https://api.example.com',
            port: '3000',
          },
        },
      });
    });

    it('should resolve variables in arrays', () => {
      const obj = {
        urls: ['${BASE_URL}/v1', '${BASE_URL}/v2'],
      };
      const result = resolveVariablesInObject(obj, 'test-project', mockDb as any);
      
      expect(result).toEqual({
        urls: ['https://api.example.com/v1', 'https://api.example.com/v2'],
      });
    });

    it('should preserve non-string values', () => {
      const obj = {
        string: '${API_KEY}',
        number: 42,
        boolean: true,
        null: null,
      };
      const result = resolveVariablesInObject(obj, 'test-project', mockDb as any);
      
      expect(result).toEqual({
        string: 'test-key-123',
        number: 42,
        boolean: true,
        null: null,
      });
    });
  });

  describe('hasUnresolvedVariables', () => {
    it('should detect unresolved variables in strings', () => {
      expect(hasUnresolvedVariables('${VAR}')).toBe(true);
      expect(hasUnresolvedVariables('No variables')).toBe(false);
    });

    it('should detect unresolved variables in objects', () => {
      expect(hasUnresolvedVariables({ key: '${VAR}' })).toBe(true);
      expect(hasUnresolvedVariables({ key: 'value' })).toBe(false);
    });

    it('should detect unresolved variables in arrays', () => {
      expect(hasUnresolvedVariables(['${VAR}'])).toBe(true);
      expect(hasUnresolvedVariables(['value'])).toBe(false);
    });

    it('should detect unresolved variables in nested structures', () => {
      expect(hasUnresolvedVariables({ nested: { key: '${VAR}' } })).toBe(true);
      expect(hasUnresolvedVariables({ nested: { key: 'value' } })).toBe(false);
    });

    it('should return false for non-string primitives', () => {
      expect(hasUnresolvedVariables(42)).toBe(false);
      expect(hasUnresolvedVariables(true)).toBe(false);
      expect(hasUnresolvedVariables(null)).toBe(false);
    });
  });

  describe('extractAllVariables', () => {
    it('should extract all unique variables from object', () => {
      const obj = {
        a: '${VAR1}',
        b: '${VAR2}',
        c: '${VAR1}',
      };
      const variables = extractAllVariables(obj);
      
      expect(variables.sort()).toEqual(['VAR1', 'VAR2']);
    });

    it('should extract variables from nested structures', () => {
      const obj = {
        config: {
          url: '${BASE_URL}',
          auth: {
            key: '${API_KEY}',
          },
        },
        items: ['${VAR1}', '${VAR2}'],
      };
      const variables = extractAllVariables(obj);
      
      expect(variables.sort()).toEqual(['API_KEY', 'BASE_URL', 'VAR1', 'VAR2']);
    });

    it('should return empty array when no variables', () => {
      const obj = { key: 'value' };
      const variables = extractAllVariables(obj);
      
      expect(variables).toEqual([]);
    });
  });
});
