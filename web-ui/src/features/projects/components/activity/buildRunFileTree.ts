import type { ToolCallRecord } from '../../../../types/api';
import { remapWrapShadowPath } from '../../../../../../src/shared/workspaces/remap-shadow-path';

export type RunFileChangeFlags = {
  read: boolean;
  modified: boolean;
  deleted: boolean;
};

export type RunFileEntry = RunFileChangeFlags & {
  /** Normalized absolute or project-relative path (posix slashes). */
  path: string;
};

const READ_TOOLS = new Set(['Read', 'read', 'read_file', 'ReadFile']);
const WRITE_TOOLS = new Set([
  'Write',
  'write',
  'StrReplace',
  'str_replace',
  'StrReplaceEditor',
  'ApplyPatch',
  'apply_patch',
  'EditNotebook',
  'Delete',
  'delete',
]);

function parseArgs(argsJson: string | null): Record<string, unknown> | null {
  if (!argsJson?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pathFromArgs(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'targetFile']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return normalizePath(v.trim());
  }
  return null;
}

function looksLikePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('/') ||
    value.includes('\\')
  );
}

export function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function mergeFlags(
  map: Map<string, RunFileEntry>,
  filePath: string,
  patch: Partial<RunFileChangeFlags>,
  realProjectPath?: string | null,
): void {
  let path = normalizePath(filePath);
  path = remapWrapShadowPath(path, realProjectPath);
  if (!path) return;
  const prev = map.get(path) ?? {
    path,
    read: false,
    modified: false,
    deleted: false,
  };
  map.set(path, {
    ...prev,
    read: prev.read || !!patch.read,
    modified: prev.modified || !!patch.modified,
    deleted: prev.deleted || !!patch.deleted,
  });
}

/**
 * Derive touched files from provider activity spans in one generation run.
 * Uses Read/Write/StrReplace/Delete tool spans and `kind: file` edit rows.
 */
export function collectRunFileChanges(
  events: ToolCallRecord[],
  options?: { realProjectPath?: string | null },
): RunFileEntry[] {
  const map = new Map<string, RunFileEntry>();
  const realProjectPath = options?.realProjectPath;

  for (const ev of events) {
    if (ev.kind === 'prompt' || ev.kind === 'stop' || ev.kind === 'session') {
      continue;
    }

    const args = parseArgs(ev.args_json);
    const tool = ev.tool_name?.trim() ?? '';

    if (ev.kind === 'file' || ev.kind === 'skill') {
      const p =
        pathFromArgs(args) ||
        (looksLikePath(tool) ? normalizePath(tool) : null);
      if (!p) continue;
      if (ev.kind === 'skill') mergeFlags(map, p, { read: true }, realProjectPath);
      else mergeFlags(map, p, { modified: true }, realProjectPath);
      continue;
    }

    if (ev.kind !== 'agent_tool') continue;

    const fromArgs = pathFromArgs(args);

    if (READ_TOOLS.has(tool)) {
      if (fromArgs) mergeFlags(map, fromArgs, { read: true }, realProjectPath);
      else if (looksLikePath(tool)) mergeFlags(map, tool, { read: true }, realProjectPath);
      continue;
    }

    if (tool === 'Grep' || tool === 'grep') {
      if (fromArgs) mergeFlags(map, fromArgs, { read: true }, realProjectPath);
      continue;
    }

    if (tool === 'Delete' || tool === 'delete') {
      if (fromArgs) mergeFlags(map, fromArgs, { deleted: true }, realProjectPath);
      else if (looksLikePath(tool)) mergeFlags(map, tool, { deleted: true }, realProjectPath);
      continue;
    }

    if (WRITE_TOOLS.has(tool)) {
      if (fromArgs) mergeFlags(map, fromArgs, { modified: true }, realProjectPath);
      else if (looksLikePath(tool)) mergeFlags(map, tool, { modified: true }, realProjectPath);
    }
  }

  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export interface RunFileTreeNode {
  name: string;
  /** Set only for file nodes. */
  filePath: string | null;
  children: RunFileTreeNode[];
  flags: RunFileChangeFlags;
}

function mergeNodeFlags(
  a: RunFileChangeFlags,
  b: RunFileChangeFlags,
): RunFileChangeFlags {
  return {
    read: a.read || b.read,
    modified: a.modified || b.modified,
    deleted: a.deleted || b.deleted,
  };
}

/** Longest shared directory prefix (ends with `/`), for display trimming. */
export function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const normalized = paths.map((p) => normalizePath(p));
  const absolute = normalized.every((p) => p.startsWith('/'));
  const split = normalized.map((p) => p.split('/').filter(Boolean));
  const first = split[0]!;
  let i = 0;
  outer: while (i < first.length) {
    for (let j = 1; j < split.length; j++) {
      if (split[j]![i] !== first[i]) break outer;
    }
    i++;
  }
  if (i === 0) return '';
  const joined = first.slice(0, i).join('/');
  return absolute ? `/${joined}/` : `${joined}/`;
}

function displayPath(fullPath: string, prefix: string): string {
  if (prefix && fullPath.startsWith(prefix)) {
    return fullPath.slice(prefix.length);
  }
  return fullPath;
}

function resolveDisplayPrefix(
  paths: string[],
  realProjectPath?: string | null,
): string {
  let prefix = commonPathPrefix(paths);
  const realBase = realProjectPath?.trim();
  if (realBase) {
    const base = `${normalizePath(realBase).replace(/\/+$/, '')}/`;
    if (paths.every((p) => normalizePath(p).startsWith(base))) {
      prefix = base;
    }
  }
  return prefix;
}

/** Paths and metadata for the shared {@link FileTree} component. */
export function runFilesForFileTree(
  entries: RunFileEntry[],
  options?: { realProjectPath?: string | null },
): {
  files: string[];
  annotations: Record<string, RunFileChangeFlags>;
} {
  if (entries.length === 0) {
    return { files: [], annotations: {} };
  }
  const paths = entries.map((e) => e.path);
  const prefix = resolveDisplayPrefix(paths, options?.realProjectPath);
  const files: string[] = [];
  const annotations: Record<string, RunFileChangeFlags> = {};
  for (const entry of entries) {
    const rel = displayPath(entry.path, prefix);
    files.push(rel);
    annotations[rel] = {
      read: entry.read,
      modified: entry.modified,
      deleted: entry.deleted,
    };
  }
  return { files, annotations };
}

/** Canonical project path touched by a span, if any. */
export function filePathFromActivitySpan(
  ev: ToolCallRecord,
  realProjectPath?: string | null,
): string | null {
  const entries = collectRunFileChanges([ev], { realProjectPath });
  return entries[0]?.path ?? null;
}

/** Display path key used by {@link runFilesForFileTree} for a canonical path. */
export function displayPathKeyForFile(
  canonicalPath: string,
  entries: RunFileEntry[],
  options?: { realProjectPath?: string | null },
): string | null {
  if (!canonicalPath || entries.length === 0) return null;
  const normalized = normalizePath(canonicalPath);
  const match = entries.find((e) => e.path === normalized);
  if (!match) return null;
  const prefix = resolveDisplayPrefix(
    entries.map((e) => e.path),
    options?.realProjectPath,
  );
  return displayPath(match.path, prefix);
}

/** Tree path key for a span, if it touches a file. */
export function displayPathKeyFromSpan(
  ev: ToolCallRecord,
  entries: RunFileEntry[],
  options?: { realProjectPath?: string | null },
): string | null {
  const canonical = filePathFromActivitySpan(ev, options?.realProjectPath);
  if (!canonical) return null;
  return displayPathKeyForFile(canonical, entries, options);
}

/** Span ids in `events` that read or wrote `pathKey`. */
export function spanIdsForDisplayPathKey(
  pathKey: string,
  events: ToolCallRecord[],
  entries: RunFileEntry[],
  options?: { realProjectPath?: string | null },
): string[] {
  if (!pathKey.trim()) return [];
  const ids: string[] = [];
  for (const ev of events) {
    if (ev.kind === 'prompt' || ev.kind === 'stop' || ev.kind === 'session') continue;
    const key = displayPathKeyFromSpan(ev, entries, options);
    if (key === pathKey) ids.push(ev.id);
  }
  return ids;
}

function filterFilesBySearch(files: string[], searchQuery: string): string[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.toLowerCase().includes(q));
}

export function runFilesForFileTreeFiltered(
  entries: RunFileEntry[],
  searchQuery: string,
  options?: { realProjectPath?: string | null },
): ReturnType<typeof runFilesForFileTree> {
  const base = runFilesForFileTree(entries, options);
  const filtered = filterFilesBySearch(base.files, searchQuery);
  const annotations: Record<string, RunFileChangeFlags> = {};
  for (const f of filtered) {
    if (base.annotations[f]) annotations[f] = base.annotations[f]!;
  }
  return { files: filtered, annotations };
}

/**
 * Build a fully-expanded directory tree from flat file entries.
 */
export function buildRunFileTree(entries: RunFileEntry[]): {
  roots: RunFileTreeNode[];
  displayPrefix: string;
} {
  if (entries.length === 0) {
    return { roots: [], displayPrefix: '' };
  }

  const prefix = commonPathPrefix(entries.map((e) => e.path));
  type MutableNode = {
    name: string;
    filePath: string | null;
    children: Map<string, MutableNode>;
    flags: RunFileChangeFlags;
  };

  const root: MutableNode = {
    name: '',
    filePath: null,
    children: new Map(),
    flags: { read: false, modified: false, deleted: false },
  };

  for (const entry of entries) {
    const rel = displayPath(entry.path, prefix);
    const segments = rel.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const isFile = i === segments.length - 1;
      let child = node.children.get(seg);
      if (!child) {
        child = {
          name: seg,
          filePath: isFile ? entry.path : null,
          children: new Map(),
          flags: { read: false, modified: false, deleted: false },
        };
        node.children.set(seg, child);
      }
      if (isFile) {
        child.filePath = entry.path;
        child.flags = { ...entry };
      }
      node = child;
    }
  }

  function sortChildren(a: MutableNode, b: MutableNode): number {
    const aDir = a.filePath === null;
    const bDir = b.filePath === null;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  }

  function toPublic(node: MutableNode): RunFileTreeNode {
    const children = [...node.children.values()]
      .sort(sortChildren)
      .map(toPublic);
    let flags = { ...node.flags };
    for (const c of children) {
      flags = mergeNodeFlags(flags, c.flags);
    }
    return {
      name: node.name,
      filePath: node.filePath,
      children,
      flags,
    };
  }

  const roots = [...root.children.values()].sort(sortChildren).map(toPublic);
  return { roots, displayPrefix: prefix };
}
