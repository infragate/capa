import { existsSync, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import type {
  PluginProvider,
  UnifiedPluginManifest,
  UnifiedSkillEntry,
  NormalizedPluginMCPServerDef,
} from '../types/plugin';
import { getProvider, getAllProviders } from './providers';

/** Map capabilities provider names to plugin provider (manifest) names */
function toPluginProvider(provider: string): PluginProvider | null {
  const p = provider.toLowerCase();
  if (p === 'cursor') return 'cursor';
  if (p === 'claude-code' || p === 'claude') return 'claude';
  return null;
}

/**
 * Discovery order: preferred providers first (in order), then fallback providers
 * that have pluginManifestPaths defined.
 * Returns ordered list of (provider, manifestPath).
 */
function getManifestSearchOrder(preferredProviders: string[]): { provider: PluginProvider; path: string }[] {
  const order: { provider: PluginProvider; path: string }[] = [];
  const seenPaths = new Set<string>();

  // Preferred providers first
  for (const p of preferredProviders) {
    const entry = getProvider(p);
    if (entry?.pluginManifestPaths) {
      const prov = toPluginProvider(p);
      if (!prov) continue;
      for (const mp of entry.pluginManifestPaths) {
        if (!seenPaths.has(mp)) {
          seenPaths.add(mp);
          order.push({ provider: prov, path: mp });
        }
      }
    }
  }

  // Fallback: all providers with plugin manifest paths, in stable order
  for (const entry of getAllProviders()) {
    if (!entry.pluginManifestPaths) continue;
    const prov = toPluginProvider(entry.id);
    if (!prov) continue;
    for (const mp of entry.pluginManifestPaths) {
      if (!seenPaths.has(mp)) {
        seenPaths.add(mp);
        order.push({ provider: prov, path: mp });
      }
    }
  }

  return order;
}

/**
 * Collect skill entries from a path: either one dir with SKILL.md or subdirs with SKILL.md.
 */
function getSkillEntriesFromPath(repoRoot: string, relativePath: string): UnifiedSkillEntry[] {
  const fullPath = join(repoRoot, relativePath);
  if (!existsSync(fullPath)) return [];

  const entries: UnifiedSkillEntry[] = [];
  const skillMdHere = join(fullPath, 'SKILL.md');
  if (existsSync(skillMdHere)) {
    const id = relativePath.split(/[/\\]/).filter(Boolean).pop() || 'skill';
    entries.push({ id, relativePath });
    return entries;
  }

  try {
    const items = readdirSync(fullPath, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const subPath = join(relativePath, item.name);
      const subSkillMd = join(repoRoot, subPath, 'SKILL.md');
      if (existsSync(subSkillMd)) {
        entries.push({ id: item.name, relativePath: subPath });
      }
    }
  } catch {
    // ignore
  }
  return entries;
}

/**
 * Parse skills field (string or array) and return unified skill entries.
 */
function parseSkillsField(
  repoRoot: string,
  raw: string | string[] | undefined,
  defaultPath: string
): UnifiedSkillEntry[] {
  const paths: string[] = [];
  if (raw === undefined || raw === null) {
    paths.push(defaultPath);
  } else if (typeof raw === 'string') {
    paths.push(raw.startsWith('./') ? raw : `./${raw}`);
  } else if (Array.isArray(raw)) {
    for (const p of raw) {
      paths.push(typeof p === 'string' && p.startsWith('./') ? p : `./${p}`);
    }
  }

  const entries: UnifiedSkillEntry[] = [];
  for (const p of paths) {
    entries.push(...getSkillEntriesFromPath(repoRoot, p));
  }
  return entries;
}

/**
 * Normalize one MCP server entry from manifest.
 * Supports subprocess (command/cmd + args/env) and remote HTTP (url + headers/oauth).
 */
function normalizeMcpServerEntry(entry: any): NormalizedPluginMCPServerDef | null {
  if (!entry || typeof entry !== 'object') return null;

  const url = entry.url;
  if (typeof url === 'string' && url.length > 0) {
    return {
      url,
      headers: entry.headers && typeof entry.headers === 'object' ? entry.headers : undefined,
      oauth2: entry.oauth2 ?? entry.oauth ?? entry.auth,
    };
  }

  const command = entry.command ?? entry.cmd;
  if (typeof command !== 'string') return null;
  return {
    cmd: command,
    args: Array.isArray(entry.args) ? entry.args : undefined,
    env: entry.env && typeof entry.env === 'object' ? entry.env : undefined,
  };
}

/**
 * Load one MCP config (object keyed by server id) from a path or return null.
 */
function loadMcpConfigFromPath(repoRoot: string, path: string): Record<string, any> | null {
  const fullPath = path.startsWith('./') ? join(repoRoot, path) : join(repoRoot, `./${path}`);
  if (!existsSync(fullPath)) return null;
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);
    const obj = data.mcpServers ?? data;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Merge server entries from an object into result (normalized).
 */
function mergeMcpEntries(
  result: Record<string, NormalizedPluginMCPServerDef>,
  obj: Record<string, any>
): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeMcpServerEntry(value);
    if (normalized) result[key] = normalized;
  }
}

/**
 * Load MCP servers from manifest: mcpServers can be a path (string), inline object,
 * or array of paths/inline configs (Cursor format).
 */
function parseMcpServers(repoRoot: string, manifest: any): Record<string, NormalizedPluginMCPServerDef> {
  const raw = manifest.mcpServers ?? manifest.mcp;
  const result: Record<string, NormalizedPluginMCPServerDef> = {};

  if (typeof raw === 'string') {
    const obj = loadMcpConfigFromPath(repoRoot, raw);
    if (obj) mergeMcpEntries(result, obj);
  } else if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (typeof item === 'string') {
        const obj = loadMcpConfigFromPath(repoRoot, item);
        if (obj) mergeMcpEntries(result, obj);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const hasCommand = 'command' in item || 'cmd' in item;
        if (hasCommand) {
          const normalized = normalizeMcpServerEntry(item);
          if (normalized) result[`server-${i}`] = normalized;
        } else {
          mergeMcpEntries(result, item);
        }
      }
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    mergeMcpEntries(result, raw);
  }

  if (Object.keys(result).length === 0) {
    const defaultObj = loadMcpConfigFromPath(repoRoot, '.mcp.json');
    if (defaultObj) mergeMcpEntries(result, defaultObj);
  }

  return result;
}

function parseCursorManifest(repoRoot: string, data: any): UnifiedPluginManifest {
  const name = typeof data.name === 'string' ? data.name : 'unknown';
  const skills = parseSkillsField(repoRoot, data.skills, 'skills');
  const mcpServers = parseMcpServers(repoRoot, data);

  return {
    name,
    version: typeof data.version === 'string' ? data.version : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    provider: 'cursor',
    skillEntries: skills,
    mcpServers,
  };
}

function parseClaudeManifest(repoRoot: string, data: any): UnifiedPluginManifest {
  const name = typeof data.name === 'string' ? data.name : 'unknown';
  const skills = parseSkillsField(repoRoot, data.skills, 'skills');
  const mcpServers = parseMcpServers(repoRoot, data);

  return {
    name,
    version: typeof data.version === 'string' ? data.version : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    provider: 'claude',
    skillEntries: skills,
    mcpServers,
  };
}

/**
 * Detect and parse the first available plugin manifest in the repo.
 * preferredProviders: e.g. capabilities.providers (['cursor', 'claude-code']).
 */
export function detectAndParseManifest(
  repoRoot: string,
  preferredProviders: string[]
): UnifiedPluginManifest | null {
  const order = getManifestSearchOrder(preferredProviders);

  for (const { provider, path } of order) {
    const fullPath = join(repoRoot, path);
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(content);
      if (provider === 'cursor') return parseCursorManifest(repoRoot, data);
      if (provider === 'claude') return parseClaudeManifest(repoRoot, data);
    } catch {
      // skip invalid manifest
    }
  }

  // Fallback: no manifest — discover skills/ and .mcp.json as claude-style
  const skillEntries = getSkillEntriesFromPath(repoRoot, 'skills');
  const defaultMcpPath = join(repoRoot, '.mcp.json');
  let mcpServers: Record<string, NormalizedPluginMCPServerDef> = {};
  if (existsSync(defaultMcpPath)) {
    try {
      const content = readFileSync(defaultMcpPath, 'utf-8');
      const data = JSON.parse(content);
      const obj = data.mcpServers ?? data;
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          const n = normalizeMcpServerEntry(value);
          if (n) mcpServers[key] = n;
        }
      }
    } catch {
      // ignore
    }
  }

  if (skillEntries.length > 0 || Object.keys(mcpServers).length > 0) {
    return {
      name: 'discovered',
      provider: 'claude',
      skillEntries,
      mcpServers,
    };
  }

  return null;
}

/**
 * Information about a plugin manifest discovered inside a repository snapshot.
 * `subpath` is the path relative to the snapshot root (empty string when the
 * manifest lives at the root).
 */
export interface DiscoveredPluginEntry {
  subpath: string;
  /** Manifest name from the JSON file (or directory basename when missing). */
  manifestName: string;
  /** Directory basename containing the manifest dir (or '' when at the repo root). */
  dirName: string;
  manifestFile: string;
}

/** Directories that should never be descended into during plugin discovery. */
const PLUGIN_WALK_SKIP = new Set([
  'node_modules', '.git', '.github', '.gitlab', '.vscode', '.idea',
  'dist', 'build', 'out', 'target', '__tests__',
]);

/**
 * Walk `repoRoot` recursively and return every directory containing a recognized
 * plugin manifest. Each entry records the manifest's relative subpath, its
 * directory basename, and the `name` field declared inside the manifest JSON.
 * Used by `findPluginInDirectory` for `@<name>`-style search resolution and by
 * `capa add` to list available plugins after a clone.
 */
export function discoverPluginEntries(
  repoRoot: string,
  preferredProviders: string[]
): DiscoveredPluginEntry[] {
  const manifestRelativePaths = getManifestSearchOrder(preferredProviders).map((o) => o.path);
  const seenDirs = new Set<string>();
  const found: DiscoveredPluginEntry[] = [];

  function visit(currentDir: string, relPath: string): void {
    for (const manifestRel of manifestRelativePaths) {
      const candidate = join(currentDir, manifestRel);
      if (!existsSync(candidate)) continue;
      const containerKey = relPath || '.';
      if (seenDirs.has(containerKey)) continue;
      seenDirs.add(containerKey);

      let manifestName: string | undefined;
      try {
        const content = readFileSync(candidate, 'utf-8');
        const data = JSON.parse(content);
        if (typeof data?.name === 'string' && data.name.length > 0) manifestName = data.name;
      } catch {
        // Malformed manifest is treated as if no name was declared.
      }

      const dirName = relPath ? relPath.split(/[/\\]/).filter(Boolean).pop() ?? '' : '';
      found.push({
        subpath: relPath,
        manifestName: manifestName ?? dirName,
        dirName,
        manifestFile: candidate,
      });
      break;
    }

    let items: Dirent[];
    try {
      items = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const name = item.name;
      if (PLUGIN_WALK_SKIP.has(name)) continue;
      // Skip dotfiles except the plugin manifest dirs themselves (handled above).
      if (name.startsWith('.') && name !== '.claude-plugin' && name !== '.cursor-plugin') continue;
      // Don't descend into manifest dirs — we've already recorded their parent.
      if (name === '.claude-plugin' || name === '.cursor-plugin') continue;
      visit(join(currentDir, name), relPath ? `${relPath}/${name}` : name);
    }
  }

  visit(repoRoot, '');
  return found;
}

/**
 * Locate a plugin inside a cloned repository snapshot using the same `@<name>`
 * semantics as skills: the search target matches either the manifest's
 * containing-directory basename or the `name` field declared in the manifest's
 * JSON file. Returns the discovered entry plus a parsed `UnifiedPluginManifest`.
 */
export function findPluginInDirectory(
  repoRoot: string,
  searchName: string,
  preferredProviders: string[]
): { entry: DiscoveredPluginEntry; manifest: UnifiedPluginManifest } | null {
  const entries = discoverPluginEntries(repoRoot, preferredProviders);
  // Match by directory basename first (cheapest, deterministic), then by manifest name.
  const target =
    entries.find((e) => e.dirName === searchName) ??
    entries.find((e) => e.manifestName === searchName);
  if (!target) return null;

  const pluginRoot = target.subpath ? join(repoRoot, target.subpath) : repoRoot;
  const manifest = detectAndParseManifest(pluginRoot, preferredProviders);
  if (!manifest) return null;
  return { entry: target, manifest };
}

/** Replace ${CLAUDE_PLUGIN_ROOT} and resolve relative paths in a string */
function resolvePluginRootInString(value: string, pluginRoot: string): string {
  const replaced = value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
  if (replaced.startsWith('./') || (replaced.startsWith('.') && !replaced.startsWith('..'))) {
    return resolve(pluginRoot, replaced);
  }
  if (!isAbsolute(replaced) && !replaced.includes('${')) {
    return resolve(pluginRoot, replaced);
  }
  return replaced;
}

/**
 * Resolve plugin root in a normalized MCP server def to produce capa MCPServerDefinition.
 * For subprocess: replaces ${CLAUDE_PLUGIN_ROOT} in cmd, args, env.
 * For remote (url): returns url, headers, oauth2 as-is.
 */
export function resolvePluginServerDef(
  def: NormalizedPluginMCPServerDef,
  pluginRoot: string
): {
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth2?: unknown;
} {
  if (def.url) {
    return {
      url: def.url,
      headers: def.headers,
      oauth2: def.oauth2,
    };
  }
  if (!def.cmd) return {};
  const cmd = resolvePluginRootInString(def.cmd, pluginRoot);
  const args = def.args?.map((a) => (typeof a === 'string' ? resolvePluginRootInString(a, pluginRoot) : a));
  let env: Record<string, string> | undefined;
  if (def.env && typeof def.env === 'object') {
    env = {};
    for (const [k, v] of Object.entries(def.env)) {
      env[k] = typeof v === 'string' ? resolvePluginRootInString(v, pluginRoot) : String(v);
    }
  }
  return { cmd, args, env };
}
