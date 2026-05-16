/**
 * Read/write helpers for `capabilities.lock`.
 *
 * The lockfile lives next to the capabilities file (yaml or json). Format is
 * auto-detected: if `capabilities.json` exists we serialize as JSON; otherwise
 * (yaml is the default) we use YAML.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type {
  Lockfile,
  LockfileFormat,
  LockPluginEntry,
  LockSkillEntry,
  LockSource,
} from '../types/lockfile';
import { VERSION } from '../version';

export const LOCKFILE_NAME = 'capabilities.lock';

/**
 * Resolve the absolute path of the lockfile for a project.
 */
export function getLockfilePath(projectPath: string): string {
  return join(projectPath, LOCKFILE_NAME);
}

/**
 * Pick the lockfile serialization format for a project.
 * Mirrors the capabilities file format when possible: JSON if `capabilities.json`
 * exists, otherwise YAML.
 */
export function detectLockfileFormat(projectPath: string): LockfileFormat {
  const jsonPath = join(projectPath, 'capabilities.json');
  return existsSync(jsonPath) ? 'json' : 'yaml';
}

/**
 * Build a fresh, empty lockfile struct.
 */
export function emptyLockfile(): Lockfile {
  return {
    version: 1,
    generator: `capa@${VERSION}`,
    generatedAt: new Date().toISOString(),
    skills: [],
    plugins: [],
  };
}

/**
 * Validate a parsed object against the lockfile schema. Throws on mismatch.
 * Currently only schema version 1 exists.
 */
function validateLockfile(parsed: unknown): Lockfile {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Lockfile is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`Unsupported lockfile version: ${String(obj.version)} (expected 1)`);
  }
  if (!Array.isArray(obj.skills)) {
    throw new Error('Lockfile.skills is not an array');
  }
  if (!Array.isArray(obj.plugins)) {
    throw new Error('Lockfile.plugins is not an array');
  }
  return {
    version: 1,
    generator: typeof obj.generator === 'string' ? obj.generator : `capa@${VERSION}`,
    generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : new Date().toISOString(),
    skills: obj.skills as LockSkillEntry[],
    plugins: obj.plugins as LockPluginEntry[],
  };
}

/**
 * Read and parse the lockfile for a project. Returns null if the file does
 * not exist. Throws on parse / schema errors so the user notices a corrupted
 * lockfile instead of silently re-resolving everything.
 */
export async function loadLockfile(projectPath: string): Promise<Lockfile | null> {
  const path = getLockfilePath(projectPath);
  if (!existsSync(path)) return null;

  const file = Bun.file(path);
  const content = await file.text();
  const trimmed = content.trim();
  if (trimmed === '') return null;

  let parsed: unknown;
  if (trimmed.startsWith('{')) {
    parsed = JSON.parse(content);
  } else {
    parsed = yaml.load(content);
  }
  return validateLockfile(parsed);
}

/**
 * Serialize and write the lockfile for a project.
 */
export async function saveLockfile(
  projectPath: string,
  lockfile: Lockfile,
  format?: LockfileFormat
): Promise<void> {
  const path = getLockfilePath(projectPath);
  const fmt = format ?? detectLockfileFormat(projectPath);
  const content = serializeLockfile(lockfile, fmt);
  await Bun.write(path, content);
}

/**
 * Serialize a lockfile to a string. Exposed for testing.
 */
export function serializeLockfile(lockfile: Lockfile, format: LockfileFormat): string {
  // Always refresh the timestamp so it reflects the actual write time.
  const out: Lockfile = { ...lockfile, generatedAt: new Date().toISOString() };
  if (format === 'json') {
    return JSON.stringify(out, null, 2) + '\n';
  }
  return yaml.dump(out, { indent: 2, lineWidth: 120, noRefs: true });
}

/**
 * Mutable builder used by the install pipeline to accumulate lock entries.
 *
 * Usage:
 *   const builder = new LockfileBuilder(loadedOrNull);
 *   builder.upsertSkill(entry);
 *   builder.upsertPlugin(entry);
 *   await saveLockfile(projectPath, builder.build());
 */
export class LockfileBuilder {
  private skills: Map<string, LockSkillEntry> = new Map();
  private plugins: Map<string, LockPluginEntry> = new Map();
  private generator: string;
  private generatedAt: string;

  constructor(initial: Lockfile | null = null) {
    this.generator = initial?.generator ?? `capa@${VERSION}`;
    this.generatedAt = initial?.generatedAt ?? new Date().toISOString();
    if (initial) {
      for (const skill of initial.skills) this.skills.set(skill.id, skill);
      for (const plugin of initial.plugins) this.plugins.set(plugin.id, plugin);
    }
  }

  /**
   * Look up a skill entry by id. Returns the entry only if its requested
   * version/ref still matches what the capabilities file is asking for —
   * otherwise the user changed the request and we must re-resolve.
   */
  findSkill(
    id: string,
    requestedVersion: string | null,
    requestedRef: string | null
  ): LockSkillEntry | null {
    const entry = this.skills.get(id);
    if (!entry) return null;
    if ((entry.requestedVersion ?? null) !== (requestedVersion ?? null)) return null;
    if ((entry.requestedRef ?? null) !== (requestedRef ?? null)) return null;
    return entry;
  }

  /**
   * Look up a plugin entry by structured key.
   *
   * Match precedence:
   *   • When `requestedSearchName` is set, the lookup pivots on that field and
   *     ignores `subpath` (which is whatever the previous walk resolved to —
   *     not a stable identity).
   *   • Otherwise the lookup compares `subpath` directly.
   */
  findPlugin(query: {
    source: string;
    repo: string;
    subpath: string | null;
    requestedSearchName?: string | null;
    requestedVersion: string | null;
    requestedRef: string | null;
  }): LockPluginEntry | null {
    const wantedSearch = query.requestedSearchName ?? null;
    for (const entry of this.plugins.values()) {
      if (entry.source !== query.source) continue;
      if (entry.repo !== query.repo) continue;
      const entrySearch = entry.requestedSearchName ?? null;
      if (entrySearch !== wantedSearch) continue;
      if (wantedSearch === null && (entry.subpath ?? null) !== (query.subpath ?? null)) continue;
      if ((entry.requestedVersion ?? null) !== (query.requestedVersion ?? null)) continue;
      if ((entry.requestedRef ?? null) !== (query.requestedRef ?? null)) continue;
      return entry;
    }
    return null;
  }

  upsertSkill(entry: LockSkillEntry): void {
    this.skills.set(entry.id, entry);
  }

  upsertPlugin(entry: LockPluginEntry): void {
    this.plugins.set(entry.id, entry);
  }

  /**
   * Drop any skills/plugins not present in the provided id sets. Called at
   * the end of install to evict stale entries (e.g. user removed a skill).
   */
  pruneToIds(skillIds: Set<string>, pluginIds: Set<string>): void {
    for (const id of [...this.skills.keys()]) {
      if (!skillIds.has(id)) this.skills.delete(id);
    }
    for (const id of [...this.plugins.keys()]) {
      if (!pluginIds.has(id)) this.plugins.delete(id);
    }
  }

  build(): Lockfile {
    const skills = [...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id));
    const plugins = [...this.plugins.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      version: 1,
      generator: this.generator,
      generatedAt: new Date().toISOString(),
      skills,
      plugins,
    };
  }
}

export type { LockSource, LockSkillEntry, LockPluginEntry, Lockfile };
