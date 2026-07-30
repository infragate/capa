import { providers } from './registry';
import type { ProviderIntegration } from '../../types/providers';

/**
 * Get a provider by id. Returns undefined for unknown providers.
 */
export function getProvider(id: string): ProviderIntegration | undefined {
  return providers[id.toLowerCase()];
}

/**
 * Get all registered provider ids.
 */
export function getAllProviderIds(): string[] {
  return Object.keys(providers);
}

/**
 * Get all registered providers as an array.
 */
export function getAllProviders(): ProviderIntegration[] {
  return Object.values(providers);
}

/**
 * Get providers that have full MCP integration (not just skill paths).
 */
export function getIntegratedProviders(): ProviderIntegration[] {
  return Object.values(providers).filter((p) => p.mcp !== undefined);
}

/**
 * Resolve a registry entry by its plugin-manifest provider id (e.g. `claude` → `claude-code`).
 */
export function getProviderByPluginProviderId(id: string): ProviderIntegration | undefined {
  const needle = id.toLowerCase();
  return getAllProviders().find((p) => p.pluginProviderId?.toLowerCase() === needle);
}

/**
 * Providers that declare `wrap` and can be launched via `capa wrap`.
 */
export function getWrappableProviders(): ProviderIntegration[] {
  return getAllProviders().filter((p) => p.wrap !== undefined);
}

/**
 * Resolve a wrappable provider by registry id or pluginProviderId alias
 * (e.g. `claude` → `claude-code`). Returns undefined if unknown or not wrappable.
 */
export function getWrappableProvider(id: string): ProviderIntegration | undefined {
  const needle = id.toLowerCase();
  const byId = getProvider(needle);
  if (byId?.wrap) return byId;
  const byPlugin = getProviderByPluginProviderId(needle);
  if (byPlugin?.wrap) return byPlugin;
  return undefined;
}

/**
 * Top-level path segment of a project-relative path (e.g. `.cursor/skills` → `.cursor`).
 */
function topLevelName(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const slash = normalized.indexOf('/');
  return slash === -1 ? normalized : normalized.slice(0, slash);
}

function addProviderOwnedTopLevelNames(p: ProviderIntegration, names: Set<string>): void {
  if (p.skillsDir) names.add(topLevelName(p.skillsDir));
  if (p.instructions?.filename) names.add(topLevelName(p.instructions.filename));
  if (p.mcp?.configPath) names.add(topLevelName(p.mcp.configPath));
  if (p.mcp?.defaultMcpFallbackPath) names.add(topLevelName(p.mcp.defaultMcpFallbackPath));
  if (p.rules?.dir) names.add(topLevelName(p.rules.dir));
  if (p.subagents?.dir) names.add(topLevelName(p.subagents.dir));
  if (p.hooks?.storage) {
    const storage = p.hooks.storage;
    if (storage.kind === 'directory') {
      names.add(topLevelName(storage.dir));
    } else if ('configPath' in storage) {
      names.add(topLevelName(storage.configPath));
    }
  }
  for (const manifest of p.pluginManifestPaths ?? []) {
    names.add(topLevelName(manifest));
  }
}

/**
 * Resolve a capabilities/wrap provider token to a registry id when possible
 * (e.g. `claude` → `claude-code`).
 */
export function resolveProviderId(raw: string): string | undefined {
  const needle = raw.trim().toLowerCase();
  if (!needle) return undefined;
  return (getProvider(needle) ?? getProviderByPluginProviderId(needle))?.id;
}

/**
 * Provider ids whose owned paths wrap should shadow (not symlink):
 * the launched wrap provider plus every entry in `capabilities.providers`.
 */
export function collectWrapExclusionProviderIds(
  wrapProviderId: string,
  capabilitiesProviders?: string[] | null,
): string[] {
  const ids = new Set<string>();
  const wrapId = resolveProviderId(wrapProviderId) ?? wrapProviderId.toLowerCase();
  ids.add(wrapId);
  for (const raw of capabilitiesProviders ?? []) {
    if (typeof raw !== 'string') continue;
    const id = resolveProviderId(raw);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Top-level names owned by the given providers (registry id or plugin alias).
 * Used by `capa wrap` so the shadow workspace skips configs that install will
 * write for the launched provider and any providers listed in capabilities.
 */
export function getProviderOwnedTopLevelNames(providerIds: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const raw of providerIds) {
    const id = resolveProviderId(raw) ?? raw.trim().toLowerCase();
    const p = getProvider(id);
    if (!p) continue;
    addProviderOwnedTopLevelNames(p, names);
  }
  return names;
}

export type { ProviderIntegration } from '../../types/providers';
export type {
  McpIntegration,
  InstructionsIntegration,
  RulesIntegration,
  SubagentsIntegration,
  WrapIntegration,
} from '../../types/providers';
