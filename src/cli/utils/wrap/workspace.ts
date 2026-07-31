import { createHash } from 'crypto';
import { basename, join, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { detectCapabilitiesFile, generateProjectId } from '../../../shared/paths';
import { LOCKFILE_NAME } from '../../../shared/lockfile';
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
import { installCommand } from '../../commands/install';
import type { ProviderIntegration } from '../../../types/providers';

export interface PreparedWorkspace {
  /** Fingerprinted cache root under ~/.capa/workspaces/<slug>/. */
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
  cold: boolean;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
}

/**
 * Short fingerprint of capabilities.yaml + capabilities.lock for workspace cache keys.
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
      parts.push(await Bun.file(lockPath).text());
    } catch {
      parts.push('nolock');
    }
  } else {
    parts.push('nolock');
  }
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12);
}

export function workspaceDirName(
  realProjectPath: string,
  providerId: string,
  fingerprint: string,
): string {
  const projectName = sanitizeName(basename(resolve(realProjectPath)));
  const provider = sanitizeName(providerId);
  return `${projectName}-${provider}-${fingerprint}`;
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
): Promise<void> {
  const marker: WorkspaceMarker = {
    realProjectPath: resolve(realProjectPath),
    providerId,
    createdAt: new Date().toISOString(),
    cachePath: resolve(cachePath),
    workingDir,
  };
  writeFileSync(join(cachePath, WORKSPACE_MARKER), JSON.stringify(marker, null, 2) + '\n');
}

async function markerValid(
  cachePath: string,
  realProjectPath: string,
  providerId: string,
  workingDir: string,
): Promise<boolean> {
  const markerPath = join(cachePath, WORKSPACE_MARKER);
  if (!existsSync(markerPath)) return false;
  try {
    const data = (await Bun.file(markerPath).json()) as WorkspaceMarker;
    // Reject legacy flat layouts (marker without workingDir, or project files at cache root).
    if (!data.workingDir || data.workingDir !== workingDir) return false;
    return (
      data.providerId === providerId &&
      resolve(data.realProjectPath) === resolve(realProjectPath)
    );
  } catch {
    return false;
  }
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

/**
 * Resolve/create the persistent wrap workspace. Cold = rebuild + install;
 * warm = sync symlinks only (skip install).
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
  const dirName = workspaceDirName(real, provider.id, fingerprint);
  const cachePath = join(workspacesDir, dirName);
  const workName = workingDirName(real);
  const workspacePath = join(cachePath, workName);

  const capabilities = await parseCapabilitiesFile(caps.path, caps.format);
  const exclusionProviderIds = collectWrapExclusionProviderIds(
    provider.id,
    capabilities.providers,
  );

  const warm =
    !isLegacyFlatCache(cachePath, workName) &&
    existsSync(workspacePath) &&
    (await markerValid(cachePath, real, provider.id, workName)) &&
    (await dbHasProject(real));

  if (warm) {
    syncTopLevelSymlinks(real, workspacePath, exclusionProviderIds);
    return {
      cachePath,
      workspacePath,
      realProjectPath: real,
      capabilitiesPath: caps.path,
      exclusionProviderIds,
      cold: false,
    };
  }

  // Cold: remove partial/stale/legacy-flat cache dir if present, rebuild nested
  if (existsSync(cachePath)) {
    rmSync(cachePath, { recursive: true, force: true });
  }
  mkdirSync(workspacePath, { recursive: true });
  buildSymlinkWorkspace(real, workspacePath, exclusionProviderIds);
  await writeMarker(cachePath, real, provider.id, workName);

  await installCommand({
    projectPath: workspacePath,
    identityPath: real,
    provider: provider.id,
  });

  return {
    cachePath,
    workspacePath,
    realProjectPath: real,
    capabilitiesPath: caps.path,
    exclusionProviderIds,
    cold: true,
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
      const same =
        process.platform === 'win32'
          ? resolve(data.realProjectPath).toLowerCase() === real.toLowerCase()
          : resolve(data.realProjectPath) === real;
      if (!same) continue;
      rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      // skip
    }
  }
  return removed;
}
