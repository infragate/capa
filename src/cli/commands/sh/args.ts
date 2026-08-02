import type { ShellCommand } from './registry';
import { slugify } from '../../../shared/slug';

/** Build the slugified-arg-name → original-arg-name map from a tool input schema. */
export function buildArgSlugs(inputSchema: any): Map<string, string> {
  const argSlugs = new Map<string, string>();
  const props = inputSchema?.properties || {};
  for (const argName of Object.keys(props)) {
    argSlugs.set(slugify(argName), argName);
  }
  return argSlugs;
}

/**
 * Extract the reserved `--raw` bypass flag from anywhere in the arg list so it
 * works regardless of position (e.g. `capa sh --raw db query` or
 * `capa sh db query --raw`). All occurrences are removed; remaining tokens are
 * dispatched as the command/args.
 */
export function parseShellGlobalFlags(args: string[]): { rawMode: boolean; tokens: string[] } {
  let rawMode = false;
  const tokens: string[] = [];
  for (const arg of args) {
    if (arg === '--raw') {
      rawMode = true;
      continue;
    }
    tokens.push(arg);
  }
  return { rawMode, tokens };
}

export function parseInlineArgs(tokens: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        result[key] = tokens[i + 1];
        i += 2;
      } else {
        result[key] = 'true';
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

/**
 * Coerce a raw string value to the type declared in the JSON Schema property.
 * Handles: string, number, integer, boolean, array, object, and
 * multi-type schemas (e.g. oneOf / type:[...]).
 */
export function coerceValue(value: string, schema: any): any {
  if (!schema) return value;

  const type = schema.type;

  if (type === 'number' || type === 'integer') {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }

  if (type === 'boolean') {
    return value !== 'false' && value !== '0';
  }

  if (type === 'array') {
    // Try JSON parse first for complex arrays (e.g. '[1,2,3]' or '[{"a":1}]')
    if (value.startsWith('[')) {
      try { return JSON.parse(value); } catch {}
    }
    // Comma-separated fallback
    const items = value.split(',').map(s => s.trim());
    const itemType = schema.items?.type;
    if (itemType === 'number' || itemType === 'integer') {
      return items.map(s => { const n = Number(s); return Number.isNaN(n) ? s : n; });
    }
    if (itemType === 'boolean') {
      return items.map(s => s !== 'false' && s !== '0');
    }
    if (itemType === 'object') {
      return items.map(s => { try { return JSON.parse(s); } catch { return s; } });
    }
    return items;
  }

  if (type === 'object') {
    try { return JSON.parse(value); } catch { return value; }
  }

  if (type === 'string') {
    return value;
  }

  // No type or unknown type — try to infer from the value
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('{') || value.startsWith('[')) {
    try { return JSON.parse(value); } catch {}
  }
  const n = Number(value);
  if (!Number.isNaN(n) && value.trim() !== '') return n;
  return value;
}

/** Resolve slugified arg names in the user's input to original names expected by the tool. */
export function resolveArgs(cmd: ShellCommand, rawArgs: Record<string, string>): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [slug, value] of Object.entries(rawArgs)) {
    const originalName = cmd.argSlugs.get(slug) ?? slug;
    const propSchema = cmd.inputSchema?.properties?.[originalName];
    resolved[originalName] = coerceValue(value, propSchema);
  }
  return resolved;
}
