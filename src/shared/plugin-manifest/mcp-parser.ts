import { existsSync, readFileSync } from 'fs';
import { join, resolve, isAbsolute, relative } from 'path';
import type { NormalizedPluginMCPServerDef } from '../../types/plugin';
import {
  asParsedMcpServerEntry,
  isPlainObject,
} from './types-helpers';

/**
 * Pull a value from `obj` matching any of the supplied case-insensitive keys.
 * Plugin manifests authored by different ecosystems use wildly different
 * spellings for the same OAuth field (Cursor: `CLIENT_ID`, Claude: `clientId`,
 * raw OAuth2 spec: `client_id`), so we normalize them here.
 */
function pickField(obj: Record<string, unknown>, names: readonly string[]): unknown {
  const lookup = new Map<string, unknown>();
  for (const key of Object.keys(obj)) {
    lookup.set(key.toLowerCase(), obj[key]);
  }
  for (const name of names) {
    const found = lookup.get(name.toLowerCase());
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Normalize an OAuth2 config block (under any of `oauth2`/`oauth`/`auth`) to
 * the canonical capa shape: `client_id`, `client_secret`, `callback_port`,
 * etc. Unknown/extra fields are preserved untouched so per-server quirks can
 * still flow through to downstream consumers.
 */
function normalizeOAuth2Block(raw: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) return raw === undefined ? undefined : (raw as Record<string, unknown>);
  const result: Record<string, unknown> = { ...raw };

  const clientId = pickField(raw, ['client_id', 'clientId', 'CLIENT_ID']);
  if (typeof clientId === 'string' && clientId.length > 0) {
    result.client_id = clientId;
  }

  const clientSecret = pickField(raw, ['client_secret', 'clientSecret', 'CLIENT_SECRET']);
  if (typeof clientSecret === 'string' && clientSecret.length > 0) {
    result.client_secret = clientSecret;
  }

  const callbackPort = pickField(raw, ['callback_port', 'callbackPort', 'CALLBACK_PORT']);
  if (typeof callbackPort === 'number' && callbackPort > 0) {
    result.callback_port = callbackPort;
  } else if (typeof callbackPort === 'string') {
    const parsed = Number(callbackPort);
    if (Number.isFinite(parsed) && parsed > 0) {
      result.callback_port = parsed;
    }
  }

  return result;
}

/**
 * Normalize one MCP server entry from manifest.
 * Supports subprocess (command/cmd + args/env) and remote HTTP (url + headers/oauth).
 */
export function normalizeMcpServerEntry(entry: unknown): NormalizedPluginMCPServerDef | null {
  const parsed = asParsedMcpServerEntry(entry);
  if (!parsed) return null;

  const url = parsed.url;
  if (typeof url === 'string' && url.length > 0) {
    const rawOauth = parsed.oauth2 ?? parsed.oauth ?? parsed.auth;
    return {
      url,
      headers: isPlainObject(parsed.headers) ? (parsed.headers as Record<string, string>) : undefined,
      oauth2: normalizeOAuth2Block(rawOauth),
    };
  }

  const command = parsed.command ?? parsed.cmd;
  if (typeof command !== 'string') return null;
  return {
    cmd: command,
    args: Array.isArray(parsed.args) ? parsed.args : undefined,
    env: isPlainObject(parsed.env) ? (parsed.env as Record<string, string>) : undefined,
  };
}

/**
 * Resolve a manifest-relative path to an absolute path inside `repoRoot`.
 * Relative paths (including `../`) are resolved against `manifestDir`. The
 * resolved path is clamped to stay inside `repoRoot`; any attempt to escape
 * the repo (via too many `..`s, absolute paths, or symlink-like tricks) is
 * rejected by returning `null`.
 */
function resolveManifestPath(
  repoRoot: string,
  manifestDir: string,
  relPath: string,
): string | null {
  if (isAbsolute(relPath)) return null;
  const base = isAbsolute(manifestDir) ? manifestDir : resolve(repoRoot, manifestDir);
  const candidate = resolve(base, relPath);
  const absRepo = resolve(repoRoot);
  const rel = relative(absRepo, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return candidate;
}

/**
 * Load one MCP config (object keyed by server id) from a manifest-relative
 * path, or return null. `manifestDir` is the directory containing the
 * referencing manifest (relative to or absolute under `repoRoot`).
 */
function loadMcpConfigFromPath(
  repoRoot: string,
  manifestDir: string,
  path: string,
): Record<string, unknown> | null {
  const fullPath = resolveManifestPath(repoRoot, manifestDir, path);
  if (!fullPath || !existsSync(fullPath)) return null;
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const data: unknown = JSON.parse(content);
    if (!isPlainObject(data)) return null;
    const obj = data.mcpServers ?? data;
    return isPlainObject(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Merge server entries from an object into result (normalized).
 */
function mergeMcpEntries(
  result: Record<string, NormalizedPluginMCPServerDef>,
  obj: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeMcpServerEntry(value);
    if (normalized) result[key] = normalized;
  }
}

/**
 * Load MCP servers from manifest: mcpServers can be a path (string), inline object,
 * or array of paths/inline configs (Cursor format).
 *
 * `manifestDir` is the directory containing the parsed manifest (relative to
 * `repoRoot`, e.g. `.cursor-plugin`). Path-typed `mcpServers` values are
 * resolved relative to it, matching how Cursor and Claude plugins author
 * their manifests (`"mcpServers": "../.cursor-mcp.json"`).
 *
 * If no servers are found and `defaultMcpFallbackPath` is provided, that path
 * is loaded relative to `repoRoot`. As a final safety net (matching long-
 * standing capa behaviour for unconventional plugin layouts), `.mcp.json` at
 * the repo root is also tried.
 */
export function parseMcpServers(
  repoRoot: string,
  manifest: unknown,
  defaultMcpFallbackPath?: string,
  manifestDir: string = '.',
): Record<string, NormalizedPluginMCPServerDef> {
  const result: Record<string, NormalizedPluginMCPServerDef> = {};
  if (!isPlainObject(manifest)) return result;

  const raw = manifest.mcpServers ?? manifest.mcp;

  if (typeof raw === 'string') {
    const obj = loadMcpConfigFromPath(repoRoot, manifestDir, raw);
    if (obj) mergeMcpEntries(result, obj);
  } else if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (typeof item === 'string') {
        const obj = loadMcpConfigFromPath(repoRoot, manifestDir, item);
        if (obj) mergeMcpEntries(result, obj);
      } else if (isPlainObject(item)) {
        const hasCommand = 'command' in item || 'cmd' in item;
        if (hasCommand) {
          const normalized = normalizeMcpServerEntry(item);
          if (normalized) result[`server-${i}`] = normalized;
        } else {
          mergeMcpEntries(result, item);
        }
      }
    }
  } else if (isPlainObject(raw)) {
    mergeMcpEntries(result, raw);
  }

  if (Object.keys(result).length === 0 && defaultMcpFallbackPath) {
    const defaultObj = loadMcpConfigFromPath(repoRoot, '.', defaultMcpFallbackPath);
    if (defaultObj) mergeMcpEntries(result, defaultObj);
  }

  if (Object.keys(result).length === 0) {
    const fallback = loadMcpConfigFromPath(repoRoot, '.', '.mcp.json');
    if (fallback) mergeMcpEntries(result, fallback);
  }

  return result;
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
