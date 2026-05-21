import TOML from '@iarna/toml';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Read a TOML file and return the parsed object.
 * Returns an empty object if the file does not exist.
 */
export function readTomlFile<T extends Record<string, unknown> = Record<string, unknown>>(
  filePath: string
): T {
  if (!existsSync(filePath)) return {} as T;
  const raw = readFileSync(filePath, 'utf-8');
  return TOML.parse(raw) as T;
}

/**
 * Write a TOML file. Creates parent directories if needed.
 * The output preserves all keys in the object — callers should read-modify-write
 * to avoid dropping user-authored keys.
 */
export function writeTomlFile<T extends Record<string, unknown>>(
  filePath: string,
  data: T
): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const output = TOML.stringify(data as TOML.JsonMap);
  writeFileSync(filePath, output, 'utf-8');
}

/**
 * Set a nested key in an object, creating intermediate objects as needed.
 * e.g. setNestedKey(obj, ['mcp_servers', 'capa'], { url: '...' })
 */
export function setNestedKey<T extends Record<string, unknown>>(
  obj: T,
  path: string[],
  value: unknown
): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = current[key];
    if (!(key in current) || typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/**
 * Delete a nested key from an object. Returns true if the key existed.
 */
export function deleteNestedKey<T extends Record<string, unknown>>(
  obj: T,
  path: string[]
): boolean {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = current[key];
    if (!(key in current) || typeof next !== 'object' || next === null || Array.isArray(next)) {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1];
  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }
  return false;
}
