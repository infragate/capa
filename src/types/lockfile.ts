/**
 * Lockfile types for `capabilities.lock`.
 *
 * The lockfile records, for each remote source in capabilities.{yaml,json}, the
 * exact commit SHA it was resolved to. This makes installs reproducible and
 * lets the cache key incoming requests by SHA so re-installs are network-free.
 *
 * Format is auto-detected based on the capabilities file format (yaml/json).
 */

export type LockfileFormat = 'json' | 'yaml';

export type LockSource = 'github' | 'gitlab';

/**
 * Locked entry for a `github`/`gitlab` skill.
 */
export interface LockSkillEntry {
  /** Skill id from capabilities file. Matches `Skill.id`. */
  id: string;
  /** Source type. */
  source: LockSource;
  /** "owner/repo" path. */
  repo: string;
  /** Skill directory name within the repo (the "@skill-name" part of `def.repo`). */
  skillName: string;
  /** Version requested in capabilities (tag/branch). null if not specified. */
  requestedVersion: string | null;
  /** Commit SHA explicitly requested in capabilities. null if not specified. */
  requestedRef: string | null;
  /** Full commit SHA actually checked out. */
  resolvedRef: string;
  /** Tag the resolved SHA corresponds to (auto-discovered for unpinned installs), if any. */
  resolvedVersion: string | null;
}

/**
 * Locked entry for a github/gitlab plugin.
 */
export interface LockPluginEntry {
  /** Stable plugin install id. Matches `SourcePlugin.id`. */
  id: string;
  /** Source type. */
  source: LockSource;
  /** Multi-segment repo path (GitLab nested groups allowed). */
  repo: string;
  /**
   * Path inside the repo where the plugin manifest lives — either pinned via
   * `def.subpath` or resolved from a `def.search` walk. null when at root.
   */
  subpath: string | null;
  /**
   * `def.search` value from the capabilities file (recursive-search target).
   * null when the user pinned to an exact subpath or to the repo root.
   */
  requestedSearchName: string | null;
  /** Version requested in capabilities. null if not specified. */
  requestedVersion: string | null;
  /** Commit SHA explicitly requested in capabilities. null if not specified. */
  requestedRef: string | null;
  /** Full commit SHA actually checked out. */
  resolvedRef: string;
  /** Tag the resolved SHA corresponds to (auto-discovered for unpinned installs), if any. */
  resolvedVersion: string | null;
  /** Plugin name from manifest. */
  manifestName: string;
  /** Plugin version from manifest, if present. */
  manifestVersion: string | null;
}

/**
 * Top-level lockfile schema.
 */
export interface Lockfile {
  /** Schema version. Bumped when fields change in incompatible ways. */
  version: 1;
  /** capa version that wrote this file (e.g. "capa@1.0.0"). */
  generator: string;
  /** ISO 8601 timestamp of when this file was last written. */
  generatedAt: string;
  /** Locked github/gitlab skill entries. */
  skills: LockSkillEntry[];
  /** Locked remote plugin entries. */
  plugins: LockPluginEntry[];
}
