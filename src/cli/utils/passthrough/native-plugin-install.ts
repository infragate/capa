/**
 * Native provider plugin install (e.g. `claude plugin install name@marketplace`).
 * Used by passthrough when the target provider can install the plugin itself.
 */

import { spawnSync } from 'child_process';
import { type CliSpawn, resolveCliSpawn } from '../wrap/cli-spawn';

// The command comes from registry data. An npm-installed `claude` is a .cmd
// shim that only runs through cmd.exe, so every token must be a plain word
// with no spaces, quotes or cmd/shell metacharacters.
const SAFE_TOKEN = /^[A-Za-z0-9._@:/=+-]+$/;

export interface NativePluginInstall {
  /** Provider ids that understand this install (e.g. `['claude-code']`). */
  providerIds: string[];
  /** Full command string, e.g. `claude plugin install frontend-design@claude-plugins-official`. */
  command: string;
}

/**
 * Validate a native install command and build its spawn call. The first
 * token is the binary, the rest are argv. Executables are spawned without a
 * shell; only a resolved .cmd/.bat shim goes through cmd.exe (see wrap's
 * resolveCliSpawn), and by then every token has passed SAFE_TOKEN.
 */
export function nativeInstallSpawn(
  command: string,
  platform: NodeJS.Platform = process.platform,
  which?: (bin: string) => string | null,
): CliSpawn {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Native plugin install command is empty.');
  }
  const unsafe = parts.find((part) => !SAFE_TOKEN.test(part));
  if (unsafe !== undefined) {
    throw new Error(`Refusing native plugin install: unsafe token "${unsafe}" in "${command.trim()}".`);
  }
  return resolveCliSpawn(parts[0]!, parts.slice(1), platform, which);
}

/** Run a native plugin install command (see nativeInstallSpawn). */
export function runNativePluginInstall(command: string): void {
  const spawn = nativeInstallSpawn(command);
  const trimmed = command.trim();
  const bin = trimmed.split(/\s+/)[0]!;

  console.log(`  → ${trimmed}`);
  const result = spawnSync(spawn.command, spawn.args, {
    stdio: 'inherit',
    shell: spawn.shell,
    env: process.env,
  });

  if (result.error) {
    throw new Error(
      `Failed to run native plugin install (${bin}): ${result.error.message}\n` +
        `  Ensure the provider CLI is on PATH.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Native plugin install exited with code ${result.status ?? 'unknown'}: ${trimmed}`,
    );
  }
}

function readStringField(obj: object | undefined, key: string): string | undefined {
  if (!obj || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Derive a Claude Code native install command from a claude-plugins registry item.
 * `snippetDef` may be a normal PluginDefinition or an inline registry def with
 * extra `plugin` / `marketplace` / `command` fields.
 */
export function claudePluginsNativeInstall(
  itemName: string,
  snippetDef?: object,
): NativePluginInstall {
  const pluginName = readStringField(snippetDef, 'plugin') || itemName;
  const marketplace = readStringField(snippetDef, 'marketplace') || 'claude-plugins-official';
  const command =
    readStringField(snippetDef, 'command') ||
    `claude plugin install ${pluginName}@${marketplace}`;

  return {
    providerIds: ['claude-code'],
    command,
  };
}
