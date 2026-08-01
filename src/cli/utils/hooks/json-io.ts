import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';

/**
 * Read a JSON config file as a plain object.
 *
 *  - Missing / empty file → `{}` (fresh start, safe to write).
 *  - Valid JSON object    → the parsed object.
 *  - Corrupted JSON or wrong shape → `null`. Callers must NOT overwrite
 *    in this case, otherwise a transient parse error / hand-edit could
 *    silently wipe the user's provider config (issues #5).
 */
export function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function ensureObject(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = obj[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  obj[key] = next;
  return next;
}

export function readObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const existing = obj[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  return null;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}
