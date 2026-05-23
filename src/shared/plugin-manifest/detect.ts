import { existsSync, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import { join, dirname, posix } from 'path';
import type {
  PluginProvider,
  UnifiedPluginManifest,
  NormalizedPluginMCPServerDef,
} from '../../types/plugin';
import { getProvider, getAllProviders, getProviderByPluginProviderId } from '../providers';
import { parseClaudeManifest } from './claude-parser';
import { parseCursorManifest } from './cursor-parser';
import {
  getSkillEntriesFromPath,
  isPlainObject,
} from './types-helpers';
import { normalizeMcpServerEntry } from './mcp-parser';

/** Map capabilities provider names to plugin provider (manifest) names */
function toPluginProvider(provider: string): PluginProvider | null {
  const entry = getProvider(provider) ?? getProviderByPluginProviderId(provider);
  if (entry?.pluginProviderId) {
    return entry.pluginProviderId as PluginProvider;
  }
  const p = provider.toLowerCase();
  if (p === 'cursor') return 'cursor';
  if (p === 'claude-code' || p === 'claude') return 'claude';
  return null;
}

function getPluginManifestContainerDirs(): Set<string> {
  return new Set(
    getAllProviders()
      .flatMap((p) => (p.pluginManifestPaths ?? []).map((mp) => dirname(mp)))
      .filter((d) => d && d !== '.')
  );
}

/**
 * Discovery order: preferred providers first (in order), then fallback providers
 * that have pluginManifestPaths defined.
 *
 * Special-case: when Claude is among the preferred providers we hoist it to
 * the front of the queue regardless of where the user listed it in
 * `capabilities.providers`. Many real-world plugins (Slack, Atlassian, …)
 * ship both `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`,
 * but only the Claude variant carries a complete OAuth2 block (clientId +
 * callbackPort). The Cursor variant typically omits the callback port and
 * forces capa to fall back to its own /api/.../oauth/callback URL, which
 * auth servers reject because the registered redirect URIs only allow the
 * loopback /callback form the Claude config describes.
 *
 * Returns ordered list of (provider, manifestPath).
 */
function getManifestSearchOrder(preferredProviders: string[]): { provider: PluginProvider; path: string }[] {
  const order: { provider: PluginProvider; path: string }[] = [];
  const seenPaths = new Set<string>();

  const claudeFirst = (ids: string[]): string[] => {
    const claudeId = ids.find((id) => {
      const entry = getProvider(id);
      return entry?.pluginProviderId === 'claude';
    });
    if (!claudeId) return ids;
    return [claudeId, ...ids.filter((id) => id !== claudeId)];
  };

  for (const p of claudeFirst(preferredProviders)) {
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

  // Fallback: every provider that exposes plugin manifest paths, Claude first.
  const allProviders = getAllProviders();
  const fallbackIds = claudeFirst(allProviders.map((p) => p.id));
  for (const id of fallbackIds) {
    const entry = getProvider(id);
    if (!entry?.pluginManifestPaths) continue;
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
      const reg = getProvider(provider) ?? getProviderByPluginProviderId(provider);
      const manifestDir = posix.dirname(path.split(/[/\\]/).join('/')) || '.';
      if (reg?.parsePluginManifest) {
        return reg.parsePluginManifest(repoRoot, data, manifestDir) as UnifiedPluginManifest;
      }
      if (provider === 'cursor') return parseCursorManifest(repoRoot, data, manifestDir);
      if (provider === 'claude') return parseClaudeManifest(repoRoot, data, manifestDir);
    } catch {
      // skip invalid manifest
    }
  }

  // Fallback: no manifest — discover skills/ and .mcp.json as claude-style
  const skillEntries = getSkillEntriesFromPath(repoRoot, 'skills');
  const defaultMcpRel =
    getProvider('claude-code')?.mcp?.defaultMcpFallbackPath ??
    getProviderByPluginProviderId('claude')?.mcp?.defaultMcpFallbackPath ??
    '.mcp.json';
  const defaultMcpPath = join(repoRoot, defaultMcpRel);
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

const PLUGIN_MANIFEST_CONTAINER_DIRS = getPluginManifestContainerDirs();

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
      // Skip dotfiles except plugin manifest container dirs (handled above at parent level).
      if (name.startsWith('.') && !PLUGIN_MANIFEST_CONTAINER_DIRS.has(name)) continue;
      // Don't descend into manifest container dirs — we've already recorded their parent.
      if (PLUGIN_MANIFEST_CONTAINER_DIRS.has(name)) continue;
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
