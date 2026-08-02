import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { readJsonFile, writeJsonFile } from '../hooks/json-io';

const CLAUDE_SETTINGS = join('.claude', 'settings.json');
const CURSOR_CLI_JSON = join('.cursor', 'cli.json');

/**
 * Pull selected real-project provider config into the wrap workspace.
 *
 * - claude-code: copy `permissions` from real `.claude/settings.json`
 * - cursor: copy `.cursor/cli.json` when present
 */
export function syncWrapProviderConfig(
  workspacePath: string,
  realProjectPath: string,
  providerId: string,
): void {
  const ws = resolve(workspacePath);
  const real = resolve(realProjectPath);

  if (providerId === 'claude-code') {
    mergeClaudePermissions(ws, real);
    return;
  }
  if (providerId === 'cursor') {
    copyCursorCliJson(ws, real);
  }
}

function mergeClaudePermissions(workspacePath: string, realProjectPath: string): void {
  const realPath = join(realProjectPath, CLAUDE_SETTINGS);
  const realSettings = readJsonFile(realPath);
  if (!realSettings || !('permissions' in realSettings)) return;

  const permissions = realSettings.permissions;
  // Only merge a real permissions object; ignore malformed values.
  if (
    permissions === null ||
    typeof permissions !== 'object' ||
    Array.isArray(permissions)
  ) {
    return;
  }

  const wsPath = join(workspacePath, CLAUDE_SETTINGS);
  const wsSettings = readJsonFile(wsPath);
  if (wsSettings === null) {
    // Corrupted workspace file — don't wipe hooks/capa entries.
    return;
  }

  wsSettings.permissions = permissions;
  writeJsonFile(wsPath, wsSettings);
}

function copyCursorCliJson(workspacePath: string, realProjectPath: string): void {
  const src = join(realProjectPath, CURSOR_CLI_JSON);
  const dest = join(workspacePath, CURSOR_CLI_JSON);

  if (!existsSync(src)) {
    // Keep wrap in sync when the real file is removed.
    if (existsSync(dest)) {
      try {
        rmSync(dest, { force: true });
      } catch {
        // best-effort
      }
    }
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
