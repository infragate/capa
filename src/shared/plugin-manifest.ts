import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import type {
  PluginProvider,
  UnifiedPluginManifest,
  UnifiedSkillEntry,
  NormalizedPluginMCPServerDef,
} from '../types/plugin';

const CURSOR_MANIFEST_PATH = '.cursor-plugin/plugin.json';
const CLAUDE_MANIFEST_PATH = '.claude-plugin/plugin.json';

const PROVIDER_MANIFEST_PATHS: Record<PluginProvider, string> = {
  cursor: CURSOR_MANIFEST_PATH,
  claude: CLAUDE_MANIFEST_PATH,
};

/** Map capabilities provider names to plugin provider (manifest) names */
function toPluginProvider(provider: string): PluginProvider | null {
  const p = provider.toLowerCase();
  if (p === 'cursor') return 'cursor';
  if (p === 'claude-code' || p === 'claude') return 'claude';
  return null;
}

/**
 * Discovery order: preferred providers first (in order), then fallback [claude, cursor].
 * Returns ordered list of (provider, manifestPath).
 */
function getManifestSearchOrder(preferredProviders: string[]): { provider: PluginProvider; path: string }[] {
  const order: { provider: PluginProvider; path: string }[] = [];
  const seen = new Set<PluginProvider>();

  for (const p of preferredProviders) {
    const prov = toPluginProvider(p);
    if (prov && !seen.has(prov)) {
      seen.add(prov);
      order.push({ provider: prov, path: PROVIDER_MANIFEST_PATHS[prov] });
    }
  }
  for (const prov of ['claude', 'cursor'] as PluginProvider[]) {
    if (!seen.has(prov)) {
      order.push({ provider: prov, path: PROVIDER_MANIFEST_PATHS[prov] });
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
