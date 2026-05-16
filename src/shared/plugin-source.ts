/**
 * Validation and helpers for structured plugin definitions.
 *
 * Replaces the old URI-based `plugin-uri.ts` parser. Plugin entries now use
 * `type: 'github' | 'gitlab'` with structured `def: { repo, subpath?, version?, ref? }`.
 */

import type { Plugin } from '../types/plugin';
import type { CachePlatform } from './cache';

const SEGMENT_RE = /^[^/:#]+$/;
const FORBIDDEN_SEGMENTS = new Set(['.', '..']);

function isValidPath(path: string, minSegments: number): boolean {
  const segs = path.split('/');
  if (segs.length < minSegments) return false;
  return segs.every(
    (s) => s.length > 0 && SEGMENT_RE.test(s) && !FORBIDDEN_SEGMENTS.has(s),
  );
}

export interface ValidatedPluginDef {
  platform: CachePlatform;
  /** `owner/repo` (or `group/.../project` for GitLab) after stripping suffixes. */
  repoPath: string;
  /**
   * Exact subpath inside the repo — either parsed from a `::` suffix in
   * `def.repo` or read from the separate `def.subpath` field. Empty string
   * when the plugin lives at the repo root or when a recursive search was
   * requested instead.
   */
  subpath: string;
  /**
   * Recursive-search target parsed from an `@name` suffix in `def.repo`.
   * Undefined when the user pinned the plugin to an exact subpath or to
   * the repo root.
   */
  search?: string;
  version?: string;
  ref?: string;
}

export interface PluginDefError {
  error: string;
}

/**
 * Validate a structured plugin entry and extract the fields needed by the
 * install loop.
 *
 * - GitHub repo path must be exactly 2 segments (owner/repo).
 * - GitLab repo path must be >= 2 segments (nested groups allowed).
 * - Subpath (if set) must have valid, non-empty segments without `.` or `..`.
 */
/**
 * Split a raw `def.repo` string into `(repoPath, repoSubpath, repoSearch)`.
 * The two suffix forms are mutually exclusive — `::` wins if a user wrote both.
 * Pinning suffixes (`:version` / `#sha`) are NOT accepted here; plugins keep
 * those in dedicated `def.version` / `def.ref` fields.
 */
function splitRepoString(raw: string): { repoPath: string; subpath?: string; search?: string; error?: string } {
  let s = raw.replace(/\.git$/, '');
  const exactIdx = s.indexOf('::');
  const atIdx = s.indexOf('@');
  if (exactIdx !== -1 && atIdx !== -1 && atIdx < exactIdx) {
    return {
      repoPath: s,
      error: `Invalid repo selector in "${raw}": cannot combine "@<name>" and "::<path>" in the same def.repo value.`,
    };
  }
  if (exactIdx !== -1) {
    return { repoPath: s.slice(0, exactIdx), subpath: s.slice(exactIdx + 2) };
  }
  if (atIdx !== -1) {
    return { repoPath: s.slice(0, atIdx), search: s.slice(atIdx + 1) };
  }
  return { repoPath: s };
}

export function validatePluginDef(plugin: Plugin): ValidatedPluginDef | PluginDefError {
  const { type, def } = plugin;
  if (type !== 'github' && type !== 'gitlab') {
    return { error: `Unsupported plugin type: ${type}` };
  }

  if (!def?.repo) {
    return { error: 'Missing required field: def.repo' };
  }

  const { repoPath, subpath: repoSubpath, search: repoSearch, error: repoError } = splitRepoString(def.repo);
  if (repoError) {
    return { error: repoError };
  }
  if (!isValidPath(repoPath, 2)) {
    return { error: `Invalid repo path: "${def.repo}". Must be at least two segments (e.g. "owner/repo").` };
  }

  if (type === 'github' && repoPath.split('/').length !== 2) {
    return { error: `GitHub repo path must be exactly "owner/repo"; got "${def.repo}".` };
  }

  // Reconcile the `::path` / `@name` suffixes in `repo` with the legacy
  // `def.subpath` field. The two cannot coexist — pick one source of truth.
  const explicitSubpath = def.subpath ?? '';
  if (explicitSubpath !== '' && repoSubpath !== undefined) {
    return {
      error:
        `\`def.subpath\` conflicts with the "::" suffix in def.repo ` +
        `("${def.repo}" already pins subpath "${repoSubpath}"). Pick one.`,
    };
  }
  if (explicitSubpath !== '' && repoSearch !== undefined) {
    return {
      error:
        `\`def.subpath\` cannot be combined with an "@<name>" suffix in def.repo ` +
        `("${def.repo}" requests a recursive search). Drop def.subpath or replace ` +
        `the suffix with "::${explicitSubpath}".`,
    };
  }

  const subpath = repoSubpath ?? explicitSubpath;
  if (subpath !== '' && !isValidPath(subpath, 1)) {
    return { error: `Invalid subpath: "${subpath}". Must be non-empty segments without "." or "..".` };
  }

  if (repoSearch !== undefined) {
    if (repoSearch.length === 0) {
      return { error: `Invalid search target in "${def.repo}": empty plugin name after "@".` };
    }
    if (repoSearch.includes('/') || repoSearch.includes('\\')) {
      return {
        error:
          `Invalid search target in "${def.repo}": "${repoSearch}" contains a slash. ` +
          `Use "::<path>" instead of "@<name>" when you need to point at a nested directory.`,
      };
    }
  }

  return {
    platform: type as CachePlatform,
    repoPath,
    subpath,
    search: repoSearch,
    version: def.version,
    ref: def.ref,
  };
}

/**
 * Generate a stable slugified id from a plugin id or manifest name.
 * No ref/version suffix — server ids and skill bindings stay stable across version bumps.
 */
export function getPluginInstallId(pluginIdOrName: string): string {
  return pluginIdOrName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Split a multi-segment repo path into owner/group and project.
 * For GitHub: `{ owner: 'owner', repo: 'repo' }`.
 * For GitLab with nested groups: `{ owner: 'group/subgroup', repo: 'project' }`.
 */
export function splitOwnerRepo(repoPath: string): { owner: string; repo: string } {
  const idx = repoPath.lastIndexOf('/');
  return { owner: repoPath.slice(0, idx), repo: repoPath.slice(idx + 1) };
}
