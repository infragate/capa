/**
 * Keeps provider "which instruction files to load" settings in sync with the
 * instruction layout (e.g. Gemini CLI `context.fileName` in
 * `.gemini/settings.json`).
 *
 * capa only adds the filename the provider should read and records exactly
 * what it added in the lockfile. User-authored entries and unrelated settings
 * are never modified, and `capa clean` removes only capa-owned values.
 */

import { join } from 'path';
import type { LockProviderConfigEntry } from '../../types/lockfile';
import type { InstructionsContextConfig } from '../../types/providers';
import { getProvider } from '../../shared/providers';
import { isCapaOwnedInstallPath } from '../../shared/install-path-guard';
import { readJsonFile, writeJsonFile } from './hooks/json-io';
import { computeInstructionLayout } from './rules-placement';

export interface ContextConfigResult {
  /** capa-owned entries to record in the lockfile. */
  owned: LockProviderConfigEntry[];
  warnings: string[];
  /** Config files that were rewritten. */
  changedFiles: string[];
}

/**
 * Apply the instruction context settings for `providers`, releasing values
 * capa previously added that are no longer wanted (including for providers
 * that were removed).
 */
export function applyInstructionContextConfig(
  projectPath: string,
  providers: string[],
  previouslyOwned: LockProviderConfigEntry[],
  options: {
    /**
     * Configure only these providers (the layout still uses all `providers`).
     * Passthrough passes the providers whose instructions file it wrote.
     */
    onlyProviders?: string[];
  } = {},
): ContextConfigResult {
  const layout = computeInstructionLayout(providers);
  const warnings: string[] = [];
  const changedFiles = new Set<string>();
  const owned: LockProviderConfigEntry[] = [];

  const only = options.onlyProviders ? new Set(options.onlyProviders) : null;
  const desired = new Map<string, { config: InstructionsContextConfig; fileNames: string[] }>();
  for (const [pid, entry] of layout.contextConfig) {
    if (!only || only.has(pid)) desired.set(pid, entry);
  }

  // Release entries for providers that are gone or whose setting moved.
  for (const prev of previouslyOwned) {
    const next = desired.get(prev.provider);
    if (next && sameSetting(prev, next.config)) continue;
    const res = releaseEntry(projectPath, prev);
    warnings.push(...res.warnings);
    if (res.changed) changedFiles.add(prev.configPath);
    if (!res.released) owned.push(prev);
  }

  for (const [pid, { config, fileNames }] of desired) {
    const prev = previouslyOwned.find((e) => e.provider === pid && sameSetting(e, config));
    const res = applyEntry(projectPath, pid, config, fileNames, layout.providerFile, prev);
    warnings.push(...res.warnings);
    if (res.changed) changedFiles.add(config.configPath);
    if (res.entry) owned.push(res.entry);
  }

  return { owned, warnings, changedFiles: [...changedFiles].sort() };
}

/** Remove every capa-owned value. Entries that couldn't be released are returned. */
export function removeInstructionContextConfig(
  projectPath: string,
  previouslyOwned: LockProviderConfigEntry[],
): ContextConfigResult {
  const warnings: string[] = [];
  const changedFiles = new Set<string>();
  const owned: LockProviderConfigEntry[] = [];
  for (const prev of previouslyOwned) {
    const res = releaseEntry(projectPath, prev);
    warnings.push(...res.warnings);
    if (res.changed) changedFiles.add(prev.configPath);
    if (!res.released) owned.push(prev);
  }
  return { owned, warnings, changedFiles: [...changedFiles].sort() };
}

/**
 * Values owned in `after` that weren't owned in `before`, as entries that can
 * be passed to {@link removeInstructionContextConfig} to undo them.
 */
export function newlyOwnedProviderConfig(
  before: LockProviderConfigEntry[],
  after: LockProviderConfigEntry[],
): LockProviderConfigEntry[] {
  const added: LockProviderConfigEntry[] = [];
  for (const entry of after) {
    const prev = before.find(
      (e) =>
        e.provider === entry.provider &&
        e.configPath === entry.configPath &&
        sameList(e.keyPath, entry.keyPath),
    );
    const values = entry.values.filter((v) => !prev?.values.includes(v));
    if (values.length === 0) continue;
    added.push({ ...entry, values, createdKey: entry.createdKey && !prev });
  }
  return added;
}

/**
 * Undo an apply whose ownership record couldn't be saved: remove values added
 * since `before` and put back values released since `before`.
 */
export function revertInstructionContextConfig(
  projectPath: string,
  before: LockProviderConfigEntry[],
  after: LockProviderConfigEntry[],
): { warnings: string[] } {
  const warnings = removeInstructionContextConfig(
    projectPath,
    newlyOwnedProviderConfig(before, after),
  ).warnings;
  for (const entry of newlyOwnedProviderConfig(after, before)) {
    const config = getProvider(entry.provider)?.instructions?.contextConfig;
    const filePath = join(projectPath, entry.configPath);
    const data = isCapaOwnedInstallPath(projectPath, filePath) ? readJsonFile(filePath) : null;
    const current = data ? readSetting(data, entry.keyPath) : null;
    if (!data || !current || current.kind === 'invalid') {
      warnings.push(`Could not restore ${entry.configPath} ${entry.keyPath.join('.')}.`);
      continue;
    }
    const values =
      current.kind === 'missing' ? [...(config?.defaultValue ?? [])] : [...current.values];
    const missing = entry.values.filter((v) => !values.includes(v));
    if (missing.length === 0) continue;
    writeSetting(data, entry.keyPath, [...values, ...missing]);
    writeJsonFile(filePath, data);
  }
  return { warnings };
}

// ---------------------------------------------------------------------------

function applyEntry(
  projectPath: string,
  providerId: string,
  config: InstructionsContextConfig,
  wanted: string[],
  providerFile: Map<string, string>,
  prev: LockProviderConfigEntry | undefined,
): { entry: LockProviderConfigEntry | null; warnings: string[]; changed: boolean } {
  const warnings: string[] = [];
  const label = `${config.configPath} ${config.keyPath.join('.')}`;
  const filePath = join(projectPath, config.configPath);
  const keep = () => ({ entry: prev ?? null, warnings, changed: false });

  if (!isCapaOwnedInstallPath(projectPath, filePath)) {
    warnings.push(`Skipped ${label}: path is not writable by capa (symlink or outside the project).`);
    return keep();
  }
  const data = readJsonFile(filePath);
  if (data === null) {
    warnings.push(`Skipped ${label}: ${config.configPath} is not valid JSON. Fix it and re-run capa install.`);
    return keep();
  }

  const current = readSetting(data, config.keyPath);
  if (current.kind === 'invalid') {
    warnings.push(`Skipped ${label}: expected a string or a list of strings.`);
    return keep();
  }

  const prevValues = new Set(prev?.values ?? []);
  // An absent setting means the provider's defaults; keep them when adding.
  const values = current.kind === 'missing' ? [...config.defaultValue] : [...current.values];
  // Drop values capa added earlier that the layout no longer wants.
  let list = values.filter((v) => !(prevValues.has(v) && !wanted.includes(v)));
  const ownedValues: string[] = [];
  for (const name of wanted) {
    if (list.includes(name)) {
      if (prevValues.has(name)) ownedValues.push(name);
    } else {
      list = [...list, name];
      ownedValues.push(name);
    }
  }

  const changed = list.length !== values.length || list.some((v, i) => v !== values[i]);
  const createdKey = prev ? prev.createdKey : current.kind === 'missing';
  if (changed) {
    if (ownedValues.length === 0 && createdKey && sameList(list, config.defaultValue)) {
      // Back to the provider defaults on a key capa created: remove it again.
      deleteSetting(data, config.keyPath);
    } else {
      writeSetting(data, config.keyPath, list);
    }
    writeJsonFile(filePath, data);
  }

  // A user-owned entry for the shared default file defeats isolation.
  const provider = getProvider(providerId);
  const defaultName = provider?.instructions?.filename;
  const isolated = defaultName && providerFile.get(providerId) !== defaultName;
  if (isolated && list.includes(defaultName) && !ownedValues.includes(defaultName)) {
    warnings.push(
      `${provider!.displayName} is set to read ${providerFile.get(providerId)}, but ${label} also ` +
        `lists ${defaultName} (not added by capa), which other providers' rules are written to. ` +
        `Remove it from ${config.keyPath.join('.')} to keep provider-targeted rules isolated.`,
    );
  }

  if (ownedValues.length === 0) return { entry: null, warnings, changed };
  return {
    entry: {
      provider: providerId,
      configPath: config.configPath,
      keyPath: [...config.keyPath],
      values: ownedValues,
      createdKey,
    },
    warnings,
    changed,
  };
}

function releaseEntry(
  projectPath: string,
  entry: LockProviderConfigEntry,
): { released: boolean; warnings: string[]; changed: boolean } {
  const warnings: string[] = [];
  const label = `${entry.configPath} ${entry.keyPath.join('.')}`;
  const filePath = join(projectPath, entry.configPath);

  if (!isCapaOwnedInstallPath(projectPath, filePath)) {
    warnings.push(`Skipped removing capa entries from ${label}: path is not writable by capa.`);
    return { released: false, warnings, changed: false };
  }
  const data = readJsonFile(filePath);
  if (data === null) {
    warnings.push(`Skipped removing capa entries from ${label}: file is not valid JSON.`);
    return { released: false, warnings, changed: false };
  }

  const current = readSetting(data, entry.keyPath);
  if (current.kind !== 'list') {
    // Missing: nothing left to remove. Invalid: the user replaced the value.
    return { released: true, warnings, changed: false };
  }

  const remaining = current.values.filter((v) => !entry.values.includes(v));
  if (remaining.length === current.values.length) {
    return { released: true, warnings, changed: false };
  }
  const defaults = getProvider(entry.provider)?.instructions?.contextConfig?.defaultValue ?? [];
  if (entry.createdKey && (remaining.length === 0 || sameList(remaining, defaults))) {
    deleteSetting(data, entry.keyPath);
  } else {
    writeSetting(data, entry.keyPath, remaining);
  }
  writeJsonFile(filePath, data);
  return { released: true, warnings, changed: true };
}

type SettingValue =
  | { kind: 'missing'; values: string[] }
  | { kind: 'list'; values: string[] }
  | { kind: 'invalid'; values: string[] };

function readSetting(data: Record<string, unknown>, keyPath: string[]): SettingValue {
  let node: unknown = data;
  for (const key of keyPath.slice(0, -1)) {
    if (!isObject(node)) return { kind: 'invalid', values: [] };
    node = node[key];
    if (node === undefined) return { kind: 'missing', values: [] };
  }
  if (!isObject(node)) return { kind: 'invalid', values: [] };
  const value = node[keyPath[keyPath.length - 1]];
  if (value === undefined) return { kind: 'missing', values: [] };
  if (typeof value === 'string') return { kind: 'list', values: [value] };
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return { kind: 'list', values: value as string[] };
  }
  return { kind: 'invalid', values: [] };
}

function writeSetting(data: Record<string, unknown>, keyPath: string[], values: string[]): void {
  let node = data;
  for (const key of keyPath.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keyPath[keyPath.length - 1]] = values;
}

/** Delete the key, then any parent objects the deletion left empty. */
function deleteSetting(data: Record<string, unknown>, keyPath: string[]): void {
  const parents: Array<Record<string, unknown>> = [data];
  for (const key of keyPath.slice(0, -1)) {
    const next = parents[parents.length - 1][key];
    if (!isObject(next)) return;
    parents.push(next);
  }
  delete parents[parents.length - 1][keyPath[keyPath.length - 1]];
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]).length > 0) break;
    delete parents[i - 1][keyPath[i - 1]];
  }
}

function sameSetting(entry: LockProviderConfigEntry, config: InstructionsContextConfig): boolean {
  return (
    entry.configPath === config.configPath &&
    entry.keyPath.length === config.keyPath.length &&
    entry.keyPath.every((k, i) => k === config.keyPath[i])
  );
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
