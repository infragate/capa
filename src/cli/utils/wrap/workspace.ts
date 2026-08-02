import { createHash } from 'crypto';
import { basename, join, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import * as yaml from 'js-yaml';
import { detectCapabilitiesFile, generateProjectId } from '../../../shared/paths';
import {
  LOCKFILE_NAME,
  lockfileSemanticPayload,
  type Lockfile,
} from '../../../shared/lockfile';
import { loadSettings, getDatabasePath, ensureCapaDir } from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';
import {
  getWorkspacesDir,
  WORKSPACE_MARKER,
  type WorkspaceMarker,
} from '../../../shared/workspaces/paths';
import { parseCapabilitiesFile } from '../../../shared/capabilities';
import { collectWrapExclusionProviderIds } from '../../../shared/providers';
import { buildSymlinkWorkspace, syncTopLevelSymlinks } from './symlink-workspace';
import { installWrapProviderNoiseRule } from './provider-noise-rule';
import { installCommand } from '../../commands/install';
import type { ProviderIntegration } from '../../../types/providers';

export interface PreparedWorkspace {
  /** Cache root under ~/.capa/workspaces/<project>-<provider>/. */
  cachePath: string;
  /**
   * Nested dir named after the real project basename — what IDEs/agents open
   * so the window title stays the original project name.
   */
  workspacePath: string;
  realProjectPath: string;
  capabilitiesPath: string;
  /**
   * Provider ids whose owned paths are excluded from the symlink tree:
   * wrap target + capabilities.providers.
   */
  exclusionProviderIds: string[];
  /** True when the cache layout was created or fully rebuilt. */
  cold: boolean;
  /** True when install ran (cold create or capabilities/lock changed). */
  installed: boolean;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
}

function pathsEqual(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Fingerprint of capabilities.yaml + semantic capabilities.lock.
 * Used only to decide whether an existing wrap workspace needs reinstall —
 * not as part of the workspace directory name.
 */
export async function computeCapabilitiesFingerprint(realProjectPath: string): Promise<string> {
  const caps = await detectCapabilitiesFile(realProjectPath);
  const parts: string[] = [];
  if (caps) {
    try {
      parts.push(await Bun.file(caps.path).text());
    } catch {
      parts.push('');
    }
  } else {
    parts.push('');
  }
  const lockPath = join(realProjectPath, LOCKFILE_NAME);
  if (existsSync(lockPath)) {
    try {
      const raw = await Bun.file(lockPath).text();
      parts.push(fingerprintLockfileText(raw));
    } catch {
      parts.push('nolock');
    }
  } else {
    parts.push('nolock');
  }
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12);
}

/** Hash lock pins only — drop generatedAt (and tolerate yaml/json). */
export function fingerprintLockfileText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'nolock';
  try {
    const parsed =
      trimmed.startsWith('{')
        ? (JSON.parse(trimmed) as Lockfile)
        : (yaml.load(trimmed) as Lockfile);
    if (!parsed || typeof parsed !== 'object') return raw;
    return JSON.stringify(lockfileSemanticPayload(parsed));
  } catch {
    return raw;
  }
}

/**
 * Stable wrap cache slug: one workspace per real project id + wrap provider.
 * Example: `capa-490f-claude-code`
 * Lockfile / capabilities changes reinstall in place; they do not create a new folder.
 */
export function workspaceDirName(realProjectPath: string, providerId: string): string {
  const projectId = generateProjectId(realProjectPath);
  const provider = sanitizeName(providerId);
  return `${projectId}-${provider}`;
}

/** Original project folder name preserved for the nested working directory. */
export function workingDirName(realProjectPath: string): string {
  return basename(resolve(realProjectPath)) || 'project';
}

async function writeMarker(
  cachePath: string,
  realProjectPath: string,
  providerId: string,
  workingDir: string,
  capabilitiesFingerprint: string,
): Promise<void> {
  const marker: WorkspaceMarker = {
    realProjectPath: resolve(realProjectPath),
    providerId,
    createdAt: new Date().toISOString(),
    cachePath: resolve(cachePath),
    workingDir,
    capabilitiesFingerprint,
  };
  writeFileSync(join(cachePath, WORKSPACE_MARKER), JSON.stringify(marker, null, 2) + '\n');
}

async function readMarker(cachePath: string): Promise<WorkspaceMarker | null> {
  const markerPath = join(cachePath, WORKSPACE_MARKER);
  if (!existsSync(markerPath)) return null;
  try {
    return (await Bun.file(markerPath).json()) as WorkspaceMarker;
  } catch {
    return null;
  }
}

async function markerMatchesWorkspace(
  cachePath: string,
  realProjectPath: string,
  providerId: string,
  workingDir: string,
): Promise<WorkspaceMarker | null> {
  const data = await readMarker(cachePath);
  if (!data) return null;
  // Reject legacy flat layouts (marker without workingDir).
  if (!data.workingDir || data.workingDir !== workingDir) return null;
  if (data.providerId !== providerId) return null;
  if (!pathsEqual(data.realProjectPath, realProjectPath)) return null;
  return data;
}

/**
 * Old wrap builds put symlinks + marker directly in the slug folder.
 * Those must be rebuilt into the nested layout.
 */
function isLegacyFlatCache(cachePath: string, workingDir: string): boolean {
  if (!existsSync(cachePath)) return false;
  const nested = join(cachePath, workingDir);
  // Flat = marker (or capabilities.yaml) at cache root and no nested working dir.
  if (existsSync(nested)) return false;
  return (
    existsSync(join(cachePath, WORKSPACE_MARKER)) ||
    existsSync(join(cachePath, 'capabilities.yaml')) ||
    existsSync(join(cachePath, 'capabilities.json'))
  );
}

async function dbHasProject(realProjectPath: string): Promise<boolean> {
  try {
    const settings = await loadSettings();
    const db = new CapaDatabase(getDatabasePath(settings));
    try {
      const id = generateProjectId(realProjectPath);
      return db.getProject(id) != null;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function cacheLooksLikeWrap(cachePath: string): boolean {
  // Marker lives on the cache root (above the nested working dir).
  return existsSync(join(cachePath, WORKSPACE_MARKER));
}

async function runWrapInstall(
  workspacePath: string,
  realProjectPath: string,
  providerId: string,
  exclusionProviderIds: Iterable<string>,
): Promise<void> {
  await installCommand({
    projectPath: workspacePath,
    identityPath: realProjectPath,
    provider: providerId,
    // Keep the real project's stored install providers unchanged.
    persistProviders: false,
  });
  installWrapProviderNoiseRule(workspacePath, providerId, exclusionProviderIds);
}

/**
 * Resolve/create the persistent wrap workspace.
 *
 * - Cache path is stable: `~/.capa/workspaces/<project>-<provider>/`
 * - Warm (same capabilities fingerprint): sync symlinks only
 * - Capabilities/lock changed: reinstall in the same workspace
 * - Missing/legacy/invalid: rebuild layout + install
 *
 * Layout:
 *   ~/.capa/workspaces/<slug>/           ← cache identity + .capa-workspace.json
 *     <originalProjectName>/             ← IDE/agent cwd (original name)
 *       src/ -> …                        ← symlinks + CAPA provider configs
 */
export async function prepareWorkspace(
  realProjectPath: string,
  provider: ProviderIntegration,
): Promise<PreparedWorkspace> {
  const real = resolve(realProjectPath);
  const caps = await detectCapabilitiesFile(real);
  if (!caps) {
    throw new Error('No capabilities file found. Run "capa init" first.');
  }

  await ensureCapaDir();
  const workspacesDir = getWorkspacesDir();
  mkdirSync(workspacesDir, { recursive: true });

  const fingerprint = await computeCapabilitiesFingerprint(real);
  const dirName = workspaceDirName(real, provider.id);
  const cachePath = join(workspacesDir, dirName);
  const workName = workingDirName(real);
  const workspacePath = join(cachePath, workName);

  const capabilities = await parseCapabilitiesFile(caps.path, caps.format);
  const exclusionProviderIds = collectWrapExclusionProviderIds(
    provider.id,
    capabilities.providers,
  );

  const legacy = isLegacyFlatCache(cachePath, workName);
  const marker = !legacy
    ? await markerMatchesWorkspace(cachePath, real, provider.id, workName)
    : null;
  const workspaceReady = !!marker && existsSync(workspacePath);
  const projectKnown = await dbHasProject(real);

  // Warm: same layout + same capabilities/lock pins → symlink sync only.
  if (
    workspaceReady &&
    projectKnown &&
    marker!.capabilitiesFingerprint === fingerprint
  ) {
    syncTopLevelSymlinks(real, workspacePath, exclusionProviderIds);
    installWrapProviderNoiseRule(workspacePath, provider.id, exclusionProviderIds);
    return {
      cachePath,
      workspacePath,
      realProjectPath: real,
      capabilitiesPath: caps.path,
      exclusionProviderIds,
      cold: false,
      installed: false,
    };
  }

  // Existing workspace, capabilities/lock changed → reinstall in place.
  if (workspaceReady) {
    syncTopLevelSymlinks(real, workspacePath, exclusionProviderIds);
    await runWrapInstall(workspacePath, real, provider.id, exclusionProviderIds);
    await writeMarker(cachePath, real, provider.id, workName, fingerprint);
    return {
      cachePath,
      workspacePath,
      realProjectPath: real,
      capabilitiesPath: caps.path,
      exclusionProviderIds,
      cold: false,
      installed: true,
    };
  }

  // Cold: remove partial/stale/legacy-flat cache dir if present, rebuild nested
  if (existsSync(cachePath)) {
    rmSync(cachePath, { recursive: true, force: true });
  }
  mkdirSync(workspacePath, { recursive: true });
  buildSymlinkWorkspace(real, workspacePath, exclusionProviderIds);
  await writeMarker(cachePath, real, provider.id, workName, fingerprint);
  await runWrapInstall(workspacePath, real, provider.id, exclusionProviderIds);

  return {
    cachePath,
    workspacePath,
    realProjectPath: real,
    capabilitiesPath: caps.path,
    exclusionProviderIds,
    cold: true,
    installed: true,
  };
}

/**
 * Remove wrap cache dirs under ~/.capa/workspaces.
 * Returns the number of cache roots removed.
 */
export async function pruneWorkspaces(): Promise<number> {
  await ensureCapaDir();
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) return 0;

  let removed = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
      if (cacheLooksLikeWrap(full)) {
        rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // skip
    }
  }
  return removed;
}

/**
 * Remove wrap cache dirs whose marker realProjectPath matches `realProjectPath`.
 */
export async function pruneWorkspacesForProject(realProjectPath: string): Promise<number> {
  await ensureCapaDir();
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) return 0;

  const real = resolve(realProjectPath);
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
      const markerPath = join(full, WORKSPACE_MARKER);
      if (!existsSync(markerPath)) continue;
      const data = (await Bun.file(markerPath).json()) as WorkspaceMarker;
      if (!data?.realProjectPath) continue;
      if (!pathsEqual(data.realProjectPath, real)) continue;
      await rm(full, { recursive: true, force: true });
      removed++;
    } catch {
      // skip
    }
  }
  return removed;
}
