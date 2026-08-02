import { existsSync, unlinkSync } from 'fs';
import {
  buildHookEntry,
  getHookConfigPath,
  removeHookEntryAt,
  upsertHookEntry,
  type HookLocator,
} from '../../../shared/providers/hook-handlers';
import type { HooksIntegration } from '../../../types/providers';
import { readTomlFile, writeTomlFile } from '../../../shared/toml-io';
import { getProvider } from '../../../shared/providers';
import type { ManagedHookRow } from '../../../db/managed-hooks';
import type { Hook } from '../../../types/hooks';
import { readJsonFile, writeJsonFile, ensureObject, readObject } from './json-io';

interface ApplyEntryArgs {
  projectPath: string;
  integration: HooksIntegration;
  output: ReturnType<typeof buildHookEntry>;
}

/**
 * Read-modify-write the provider's hook config file with the given entry.
 * Handles JSON / TOML, `cursor-v1` envelope, and inline-config vs
 * standalone storage.
 */
export function applyHookEntryToConfig(args: ApplyEntryArgs): { configPath: string; locator: HookLocator } {
  const { projectPath, integration, output } = args;
  const configPath = getHookConfigPath(integration, projectPath);

  if (integration.storage.kind === 'inline-config' && integration.storage.format === 'toml') {
    const config = readTomlFile(configPath);
    const root = ensureObject(config, integration.storage.hooksKey);
    const locator = upsertHookEntry(integration, root, output);
    writeTomlFile(configPath, config);
    return { configPath, locator };
  }

  const config = readJsonFile(configPath);
  if (config === null) {
    throw new Error(
      `existing config at ${configPath} is not a valid JSON object — refusing to overwrite. Fix the file by hand and re-run capa install.`,
    );
  }

  let hooksRoot: Record<string, unknown>;
  if (integration.storage.kind === 'standalone') {
    if (integration.storage.envelope === 'cursor-v1') {
      if (typeof config.version !== 'number') config.version = 1;
      hooksRoot = ensureObject(config, 'hooks');
    } else {
      hooksRoot = config;
    }
  } else if (integration.storage.kind === 'inline-config') {
    hooksRoot = ensureObject(config, integration.storage.hooksKey);
  } else {
    throw new Error(`directory-storage hooks are not yet supported (${integration.storage.kind})`);
  }

  const locator = upsertHookEntry(integration, hooksRoot, output);
  writeJsonFile(configPath, config);
  return { configPath, locator };
}

/**
 * Surgically delete a single (provider, hook) entry from the on-disk
 * config using the locator stored in `managed_hooks`.
 *
 * Errors propagate to the caller — pruneOrphanHooks/cleanHooks catch them
 * and surface as warnings so a malformed config never aborts the install.
 */
export function removeManagedHookEntry(
  projectPath: string,
  row: ManagedHookRow,
  options: { preserveScript?: boolean } = {},
): void {
  const preserveScript = !!options.preserveScript;
  const provider = getProvider(row.providerId);
  if (!provider?.hooks) {
    if (!preserveScript && row.scriptPath && existsSync(row.scriptPath)) {
      try { unlinkSync(row.scriptPath); } catch {}
    }
    return;
  }
  const integration = provider.hooks;
  const configPath = row.configPath;

  let locator: HookLocator;
  try {
    locator = JSON.parse(row.locator) as HookLocator;
    if (!Array.isArray(locator)) throw new Error('locator is not an array');
  } catch (err: unknown) {
    throw new Error(`invalid locator JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!existsSync(configPath)) {
    if (!preserveScript && row.scriptPath && existsSync(row.scriptPath)) {
      try { unlinkSync(row.scriptPath); } catch {}
    }
    return;
  }

  if (integration.storage.kind === 'inline-config' && integration.storage.format === 'toml') {
    const config = readTomlFile(configPath);
    const root = readObject(config, integration.storage.hooksKey);
    if (root) {
      removeHookEntryAt(integration, root, locator, row.hookId);
      if (Object.keys(root).length === 0) {
        delete (config as Record<string, unknown>)[integration.storage.hooksKey];
      }
    }
    writeTomlFile(configPath, config);
  } else {
    const config = readJsonFile(configPath);
    if (config === null) {
      throw new Error(
        `existing config at ${configPath} is not a valid JSON object — refusing to rewrite. Fix the file by hand and re-run.`,
      );
    }
    let root: Record<string, unknown> | null;
    let rootKey: string | null = null;
    if (integration.storage.kind === 'standalone') {
      if (integration.storage.envelope === 'cursor-v1') {
        root = readObject(config, 'hooks');
        rootKey = 'hooks';
      } else {
        root = config;
      }
    } else if (integration.storage.kind === 'inline-config') {
      root = readObject(config, integration.storage.hooksKey);
      rootKey = integration.storage.hooksKey;
    } else {
      return;
    }
    if (root) {
      removeHookEntryAt(integration, root, locator, row.hookId);
      if (rootKey && Object.keys(root).length === 0) {
        delete (config as Record<string, unknown>)[rootKey];
      }
    }
    writeJsonFile(configPath, config);
  }

  if (!preserveScript && row.scriptPath && existsSync(row.scriptPath)) {
    try { unlinkSync(row.scriptPath); } catch {}
  }
}

// Re-export types/functions used by install.ts
export { buildHookEntry, getHookConfigPath } from '../../../shared/providers/hook-handlers';
export type { HookLocator } from '../../../shared/providers/hook-handlers';
