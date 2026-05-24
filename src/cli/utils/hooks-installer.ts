/**
 * Install / prune lifecycle hooks across providers.
 *
 * `installHooks`:
 *   1. Resolve each hook's body (inline / remote / github / gitlab / local)
 *      and materialise `command`-type bodies under
 *      `~/.capa/hooks/<projectId>/<hookId>` (chmod +x by default).
 *   2. For every `(provider, hook)` pair where the provider supports the
 *      requested event, build the shape-specific entry, upsert it into the
 *      provider's config file, and record the entry in `db.managed_hooks`.
 *   3. Surface warnings (rather than throwing) for unsupported providers,
 *      missing event mappings, write failures, etc.
 *
 * `pruneOrphanHooks`:
 *   • Walks `db.managed_hooks` and removes every entry whose provider /
 *     hook combination is no longer requested by the current capabilities
 *     file. Stale config entries are removed surgically using the stored
 *     locator; the row is dropped from the DB.
 *
 * `cleanHooks`:
 *   • Used by `capa clean` to remove every capa-installed hook entry for
 *     a project regardless of the current capabilities file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { createHash } from 'crypto';
import type { CapaDatabase } from '../../db/database';
import type { ManagedHookRow } from '../../db/managed-hooks';
import { getProvider } from '../../shared/providers';
import {
  buildHookEntry,
  getHookConfigPath,
  removeHookEntryAt,
  upsertHookEntry,
  type HookLocator,
} from '../../shared/providers/hook-handlers';
import type { HooksIntegration, ProviderEventMapping } from '../../types/providers';
import type { CanonicalHookEvent, Hook, HookSource } from '../../types/hooks';
import type { LockHookEntry } from '../../types/lockfile';
import type { LockfileBuilder } from '../../shared/lockfile';
import type { AuthenticatedFetch } from '../../shared/authenticated-fetch';
import type { CachePlatform, GetSnapshotResult } from '../../shared/cache';
import { fetchRepoFile, fetchTextFile } from '../../shared/repo-file';
import { getHookScriptDir } from '../../shared/config';
import { readTomlFile, writeTomlFile } from '../../shared/toml-io';
import { taskLog } from '../ui';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type SnapshotResolver = (
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts?: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean },
) => Promise<GetSnapshotResult>;

export interface InstallHooksOptions {
  projectPath: string;
  projectId: string;
  /** Path of the capabilities file (used to resolve `local` source paths). */
  capabilitiesFilePath: string;
  hooks: Hook[];
  providers: string[];
  db: CapaDatabase;
  authFetch: AuthenticatedFetch;
  getRepoSnapshot: SnapshotResolver;
  noCache?: boolean;
  /** When set, hook lockfile entries are recorded for `github`/`gitlab`/`remote` sources. */
  lockBuilder?: LockfileBuilder;
}

export interface InstallHooksResult {
  /** Number of (provider, hook) entries successfully installed. */
  installed: number;
  /** Non-fatal warnings collected during install. */
  warnings: string[];
}

/**
 * Top-level orchestrator. See module doc-comment for the contract.
 */
export async function installHooks(opts: InstallHooksOptions): Promise<InstallHooksResult> {
  const { projectPath, projectId, hooks, providers, db } = opts;
  const warnings: string[] = [];
  let installed = 0;

  if (hooks.length === 0) return { installed, warnings };

  // Step 1: resolve each hook's body once. Bodies are reused across providers.
  const resolvedBodies = new Map<string, ResolvedHookBody>();
  for (const hook of hooks) {
    try {
      const body = await resolveHookBody(hook, opts);
      resolvedBodies.set(hook.id, body);

      // Lockfile pinning for remote / repo-backed sources only.
      if (opts.lockBuilder && hook.source && body.lockEntry) {
        opts.lockBuilder.upsertHook(body.lockEntry);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${hook.id}": failed to resolve body — ${msg}`);
    }
  }

  // Step 2: materialise command bodies under ~/.capa/hooks/<projectId>/.
  const hookScriptPaths = new Map<string, string>();
  for (const hook of hooks) {
    const body = resolvedBodies.get(hook.id);
    if (!body) continue;
    if ((hook.type ?? 'command') !== 'command') continue;

    // If the user inlined `command:` and provided no source, the entry value
    // is the literal command string. We don't materialise a script in that
    // case — the provider runs it directly.
    if (!hook.source) {
      hookScriptPaths.set(hook.id, hook.command ?? '');
      continue;
    }

    try {
      const scriptPath = materialiseHookScript({
        projectId,
        hookId: hook.id,
        body: body.text,
        executable: hook.source.executable !== false,
      });
      hookScriptPaths.set(hook.id, scriptPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${hook.id}": failed to write script — ${msg}`);
    }
  }

  // Step 3: per-provider installation.
  for (const providerId of providers) {
    const provider = getProvider(providerId);
    if (!provider) {
      warnings.push(`Hooks: unknown provider "${providerId}" — skipping`);
      continue;
    }
    if (!provider.hooks) {
      warnings.push(`Hooks: ${provider.displayName} does not support project-level hooks (skipping)`);
      continue;
    }
    for (const hook of hooks) {
      const targets = scopeHookForProvider(hook, providerId);
      if (!targets) continue;

      const body = resolvedBodies.get(hook.id);
      if (!body) continue;

      const eventName = resolveProviderEventName(provider.hooks, hook, providerId);
      if (!eventName) {
        warnings.push(
          `Hook "${hook.id}": ${provider.displayName} has no mapping for "${hook.on}" — skipping`,
        );
        continue;
      }
      const mapping = pickMapping(provider.hooks, hook.on, providerId);
      if (!mapping) continue;

      try {
        const runReference = (hook.type ?? 'command') === 'prompt'
          ? (hook.prompt ?? body.text)
          : hookScriptPaths.get(hook.id) || hook.command || '';

        if (!runReference) {
          warnings.push(`Hook "${hook.id}": empty run reference for ${provider.displayName} — skipping`);
          continue;
        }

        const out = buildHookEntry(provider.hooks, {
          hook,
          mapping,
          runReference,
        });

        const { configPath, locator } = applyHookEntryToConfig({
          projectPath,
          integration: provider.hooks,
          output: out,
        });

        const scriptPath = body.materialised ? hookScriptPaths.get(hook.id) ?? null : null;
        db.upsertManagedHook({
          projectId,
          providerId,
          hookId: hook.id,
          configPath,
          locator: JSON.stringify(locator),
          scriptPath,
        });
        installed++;
        taskLog(`  ✓ Installed hook "${hook.id}" → ${provider.displayName} (${eventName})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Hook "${hook.id}" → ${provider.displayName}: ${msg}`);
      }
    }
  }

  return { installed, warnings };
}

export interface PruneOrphanHooksResult {
  removed: number;
  warnings: string[];
}

/**
 * Bring `db.managed_hooks` in sync with the current capabilities file by
 * removing entries that are no longer requested (per provider).
 */
export function pruneOrphanHooks(
  projectPath: string,
  projectId: string,
  desiredHooks: Hook[],
  desiredProviders: string[],
  db: CapaDatabase,
): PruneOrphanHooksResult {
  const warnings: string[] = [];
  let removed = 0;

  const desiredByProvider = new Map<string, Set<string>>();
  for (const providerId of desiredProviders) {
    const ids = new Set<string>();
    for (const h of desiredHooks) {
      const targets = scopeHookForProvider(h, providerId);
      if (targets) ids.add(h.id);
    }
    desiredByProvider.set(providerId, ids);
  }

  const existing = db.getManagedHooks(projectId);
  for (const row of existing) {
    const desired = desiredByProvider.get(row.providerId);
    // Provider still active and hook still declared → keep.
    if (desired && desired.has(row.hookId)) continue;

    try {
      removeManagedHookEntry(projectPath, row);
      removed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${row.hookId}" on "${row.providerId}": prune failed — ${msg}`);
    } finally {
      db.removeManagedHook(row.projectId, row.providerId, row.hookId);
    }
  }
  return { removed, warnings };
}

/**
 * Remove every capa-managed hook entry for `projectId`. Used by `capa clean`.
 */
export function cleanHooks(projectPath: string, projectId: string, db: CapaDatabase): { removed: number; warnings: string[] } {
  const warnings: string[] = [];
  let removed = 0;
  const rows = db.getManagedHooks(projectId);
  for (const row of rows) {
    try {
      removeManagedHookEntry(projectPath, row);
      removed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${row.hookId}" on "${row.providerId}": clean failed — ${msg}`);
    }
  }
  db.clearManagedHooks(projectId);
  return { removed, warnings };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ResolvedHookBody {
  /** The resolved script body or prompt text. */
  text: string;
  /** True when the body was fetched from outside (and we need a script path). */
  materialised: boolean;
  /** Optional lockfile pin for remote / repo sources. */
  lockEntry?: LockHookEntry;
}

async function resolveHookBody(hook: Hook, opts: InstallHooksOptions): Promise<ResolvedHookBody> {
  if (!hook.source) {
    return { text: hook.command ?? hook.prompt ?? '', materialised: false };
  }
  const source = hook.source;
  let text = '';
  let lockEntry: LockHookEntry | undefined;

  switch (source.type) {
    case 'inline': {
      text = source.content ?? '';
      break;
    }
    case 'remote': {
      if (!source.url) throw new Error('source.type=remote requires url');
      text = await fetchTextFile(source.url, {
        authFetch: opts.authFetch,
        sourceLabel: `hook "${hook.id}"`,
      });
      lockEntry = {
        id: hook.id,
        source: 'remote',
        repo: null,
        url: source.url,
        requestedVersion: null,
        requestedRef: null,
        resolvedRef: null,
        resolvedVersion: null,
        bodySha256: sha256(text),
      };
      break;
    }
    case 'github':
    case 'gitlab': {
      if (!source.def?.repo) throw new Error(`source.type=${source.type} requires def.repo`);
      const result = await fetchRepoFile(source.type, source.def.repo, opts.getRepoSnapshot, opts.authFetch, {
        noCache: opts.noCache,
      });
      text = result.content;
      lockEntry = {
        id: hook.id,
        source: source.type,
        repo: result.parsed.ownerRepo,
        url: null,
        requestedVersion: result.parsed.version ?? null,
        requestedRef: result.parsed.sha ?? null,
        resolvedRef: result.resolvedSha,
        resolvedVersion: result.resolvedVersion ?? null,
        bodySha256: sha256(text),
      };
      break;
    }
    case 'local': {
      if (!source.path) throw new Error('source.type=local requires path');
      const baseDir = dirname(opts.capabilitiesFilePath);
      const fullPath = resolvePath(baseDir, source.path);
      if (!existsSync(fullPath)) throw new Error(`local file does not exist: ${fullPath}`);
      text = readFileSync(fullPath, 'utf-8');
      break;
    }
  }

  return { text, materialised: true, lockEntry };
}

/**
 * Write the resolved hook body to `~/.capa/hooks/<projectId>/<hookId>` and
 * (optionally) chmod +x. Returns the absolute script path.
 */
function materialiseHookScript(input: {
  projectId: string;
  hookId: string;
  body: string;
  executable: boolean;
}): string {
  const dir = getHookScriptDir(input.projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, input.hookId);
  writeFileSync(file, input.body, 'utf-8');
  if (input.executable) {
    try {
      chmodSync(file, 0o755);
    } catch {
      // chmod is best-effort on platforms that don't support it.
    }
  }
  return file;
}

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
function applyHookEntryToConfig(args: ApplyEntryArgs): { configPath: string; locator: HookLocator } {
  const { projectPath, integration, output } = args;
  const configPath = getHookConfigPath(integration, projectPath);

  if (integration.storage.kind === 'inline-config' && integration.storage.format === 'toml') {
    const config = readTomlFile(configPath);
    const root = ensureObject(config, integration.storage.hooksKey);
    const locator = upsertHookEntry(integration, root, output);
    writeTomlFile(configPath, config);
    return { configPath, locator };
  }

  // JSON-based storage (standalone or inline-config).
  const config = readJsonFile(configPath);

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
function removeManagedHookEntry(projectPath: string, row: ManagedHookRow): void {
  const provider = getProvider(row.providerId);
  if (!provider?.hooks) {
    // Provider was removed from the registry — drop the script if any.
    if (row.scriptPath && existsSync(row.scriptPath)) {
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
    // The user already deleted the config; nothing left to remove.
    if (row.scriptPath && existsSync(row.scriptPath)) {
      try { unlinkSync(row.scriptPath); } catch {}
    }
    return;
  }

  if (integration.storage.kind === 'inline-config' && integration.storage.format === 'toml') {
    const config = readTomlFile(configPath);
    const root = readObject(config, integration.storage.hooksKey);
    if (root) {
      removeHookEntryAt(integration, root, locator, row.hookId);
      // If the hooks root is empty, drop it from the config too.
      if (Object.keys(root).length === 0) {
        delete (config as Record<string, unknown>)[integration.storage.hooksKey];
      }
    }
    writeTomlFile(configPath, config);
  } else {
    const config = readJsonFile(configPath);
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
      // directory-storage hooks aren't currently installed, so prune is a no-op.
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

  if (row.scriptPath && existsSync(row.scriptPath)) {
    try { unlinkSync(row.scriptPath); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Event-mapping helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of provider ids targeted by this hook's `providers` field
 * (or null when the provider is not targeted). Returns an array for parity
 * with possible future expansion (e.g. wildcards).
 */
function scopeHookForProvider(hook: Hook, providerId: string): string[] | null {
  if (!hook.providers || hook.providers.length === 0) return [providerId];
  return hook.providers.includes(providerId) ? [providerId] : null;
}

function pickMapping(integration: HooksIntegration, on: string, providerId: string): ProviderEventMapping | null {
  // Provider-scoped event: only honor when prefix matches our provider id.
  const colonIdx = on.indexOf(':');
  if (colonIdx > 0) {
    const prefix = on.slice(0, colonIdx);
    if (prefix.toLowerCase() !== providerId.toLowerCase()) return null;
    return { event: on.slice(colonIdx + 1) };
  }
  const canonical = on as CanonicalHookEvent;
  return integration.eventMap[canonical] ?? null;
}

function resolveProviderEventName(
  integration: HooksIntegration,
  hook: Hook,
  providerId: string,
): string | null {
  const m = pickMapping(integration, hook.on, providerId);
  return m ? m.event : null;
}

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    if (!raw.trim()) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function ensureObject(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = obj[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  obj[key] = next;
  return next;
}

function readObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const existing = obj[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  return null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

// Re-exports for tests.
export { resolveProviderEventName as _resolveProviderEventName };
