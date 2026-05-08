import TOML from '@iarna/toml';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Read a TOML file and return the parsed object.
 * Returns an empty object if the file does not exist.
 */
export function readTomlFile(filePath: string): Record<string, any> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  return TOML.parse(raw) as Record<string, any>;
}

/**
 * Write a TOML file. Creates parent directories if needed.
 * The output preserves all keys in the object — callers should read-modify-write
 * to avoid dropping user-authored keys.
 */
export function writeTomlFile(filePath: string, data: Record<string, any>): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const output = TOML.stringify(data as any);
  writeFileSync(filePath, output, 'utf-8');
}

/**
 * Set a nested key in an object, creating intermediate objects as needed.
 * e.g. setNestedKey(obj, ['mcp_servers', 'capa'], { url: '...' })
 */
export function setNestedKey(obj: Record<string, any>, path: string[], value: any): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current) || typeof current[path[i]] !== 'object') {
      current[path[i]] = {};
    }
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}

/**
 * Delete a nested key from an object. Returns true if the key existed.
 */
export function deleteNestedKey(obj: Record<string, any>, path: string[]): boolean {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current) || typeof current[path[i]] !== 'object') {
      return false;
    }
    current = current[path[i]];
  }
  const lastKey = path[path.length - 1];
  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }
  return false;
}
