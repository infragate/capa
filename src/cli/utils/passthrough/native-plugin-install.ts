/**
 * Native provider plugin install (e.g. `claude plugin install name@marketplace`).
 * Used by passthrough when the target provider can install the plugin itself.
 */

import { spawnSync } from 'child_process';

export interface NativePluginInstall {
  /** Provider ids that understand this install (e.g. `['claude-code']`). */
  providerIds: string[];
  /** Full command string, e.g. `claude plugin install frontend-design@claude-plugins-official`. */
  command: string;
}

/**
 * Run a native plugin install command. Uses the first token as the binary
 * and the rest as argv (no shell), matching wrap's approach to `claude`.
 */
export function runNativePluginInstall(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error('Native plugin install command is empty.');
  }

  const parts = trimmed.split(/\s+/);
  const bin = parts[0]!;
  const args = parts.slice(1);

  console.log(`  → ${trimmed}`);
  const result = spawnSync(bin, args, {
    stdio: 'inherit',
    // Windows needs shell to resolve .cmd shims for `claude`.
    shell: process.platform === 'win32',
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
