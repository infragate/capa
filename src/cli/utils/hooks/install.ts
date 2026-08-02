import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { join, relative as relativePath, isAbsolute, resolve as resolvePath, sep as pathSep } from 'path';
import type { CapaDatabase } from '../../../db/database';
import type { Hook } from '../../../types/hooks';
import type { LockfileBuilder } from '../../../shared/lockfile';
import type { AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import type { CachePlatform, GetSnapshotResult } from '../../../shared/cache';
import { getProvider } from '../../../shared/providers';
import { getHookScriptDir } from '../../../shared/config';
import { isSafeHookId } from '../../../shared/hooks-validate';
import { taskLog } from '../../ui';
import { resolveHookBody, type ResolvedHookBody } from './resolve-body';
import { applyHookEntryToConfig, buildHookEntry } from './config-apply';
import { scopeHookForProvider, pickMapping, resolveProviderEventName } from './provider-map';

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
  /**
   * When false, skip writing `managed_hooks` rows (passthrough mode).
   * @default true
   */
  trackManaged?: boolean;
  /**
   * Prefix for provider entry `name` tags. Default `'capa:'`.
   * Pass `''` for passthrough so `capa clean` will not remove these entries.
   */
  nameTagPrefix?: string;
  /** When true, suppress CLI progress lines (server / quiet callers). */
  quiet?: boolean;
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
  const trackManaged = opts.trackManaged !== false;
  const nameTagPrefix = opts.nameTagPrefix;
  const warnings: string[] = [];
  let installed = 0;

  if (hooks.length === 0) return { installed, warnings };

  // Step 1: resolve each hook's body once. Bodies are reused across providers.
  const resolvedBodies = new Map<string, ResolvedHookBody>();
  for (const hook of hooks) {
    try {
      const body = await resolveHookBody(hook, opts);
      resolvedBodies.set(hook.id, body);

      if (opts.lockBuilder && hook.source && body.lockEntry) {
        opts.lockBuilder.upsertHook(body.lockEntry);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Hook "${hook.id}": failed to resolve body — ${msg}`);
    }
  }

  // Step 2: figure out the run reference for each command-type hook.
  const hookScriptPaths = new Map<string, string>();
  for (const hook of hooks) {
    const body = resolvedBodies.get(hook.id);
    if (!body) continue;
    if ((hook.type ?? 'command') !== 'command') continue;

    if (!hook.source) {
      hookScriptPaths.set(hook.id, hook.command ?? '');
      continue;
    }

    if (body.localPath) {
      hookScriptPaths.set(hook.id, toPortableHookReference(body.localPath, projectPath));
      continue;
    }

    try {
      const scriptPath = materialiseHookScript({
        projectId,
        hookId: hook.id,
        body: body.text,
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
          ...(nameTagPrefix !== undefined ? { nameTagPrefix } : {}),
        });

        const { configPath, locator } = applyHookEntryToConfig({
          projectPath,
          integration: provider.hooks,
          output: out,
        });

        if (trackManaged) {
          const scriptPath = body.needsMaterialisation
            ? hookScriptPaths.get(hook.id) ?? null
            : null;
          db.upsertManagedHook({
            projectId,
            providerId,
            hookId: hook.id,
            configPath,
            locator: JSON.stringify(locator),
            scriptPath,
          });
        }
        installed++;
        if (!opts.quiet) {
          taskLog(`  ✓ Installed hook "${hook.id}" → ${provider.displayName} (${eventName})`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Hook "${hook.id}" → ${provider.displayName}: ${msg}`);
      }
    }
  }

  return { installed, warnings };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Turn the absolute path of a `local` hook script into the reference written
 * into the provider config.
 *
 * Provider hooks run with their working directory at the project root, so a
 * script that lives inside the project is referenced by a project-relative
 * path (forward slashes, `./`-prefixed so it executes as a path rather than a
 * PATH lookup). That keeps the committed config portable — other clones don't
 * inherit the author's absolute, machine-specific path.
 *
 * A script outside the project can't be committed meaningfully, so its
 * absolute path is kept as-is.
 */
function toPortableHookReference(absScriptPath: string, projectPath: string): string {
  const rel = relativePath(projectPath, absScriptPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return absScriptPath;
  }
  return `./${rel.split(pathSep).join('/')}`;
}

/**
 * Write the resolved hook body to `~/.capa/hooks/<projectId>/<hookId>` and
 * chmod +x. Returns the absolute script path.
 */
function materialiseHookScript(input: {
  projectId: string;
  hookId: string;
  body: string;
}): string {
  if (!isSafeHookId(input.hookId)) {
    throw new Error(
      `unsafe hook id "${input.hookId}" — refusing to materialise script`,
    );
  }
  const dir = getHookScriptDir(input.projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, input.hookId);
  const resolvedFile = resolvePath(file);
  const resolvedDir = resolvePath(dir);
  if (!resolvedFile.startsWith(resolvedDir + pathSep)) {
    throw new Error(`hook script path escapes hook script dir: ${resolvedFile}`);
  }
  writeFileSync(file, input.body, 'utf-8');
  try {
    chmodSync(file, 0o755);
  } catch {
    // chmod is best-effort on platforms that don't support it.
  }
  return file;
}
