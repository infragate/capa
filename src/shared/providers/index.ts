import { readdirSync } from "fs";
import { resolve } from "path";
import type {
	ProviderIntegration,
	WrapLaunchConfig,
} from "../../types/providers";
import { providers } from "./registry";

/**
 * Resolved target for `capa wrap <token>`: provider entry plus the launch
 * config to use (primary wrap or a wrap.aliases entry).
 */
export interface WrapTarget {
	provider: ProviderIntegration;
	wrap: WrapLaunchConfig;
	/** Token the user passed (registry id, pluginProviderId, or wrap alias). */
	token: string;
}

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
export function getProviderByPluginProviderId(
	id: string,
): ProviderIntegration | undefined {
	const needle = id.toLowerCase();
	return getAllProviders().find(
		(p) => p.pluginProviderId?.toLowerCase() === needle,
	);
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
 * Does not resolve `wrap.aliases` tokens — use {@link resolveWrapTarget} for that.
 */
export function getWrappableProvider(
	id: string,
): ProviderIntegration | undefined {
	const needle = id.toLowerCase();
	const byId = getProvider(needle);
	if (byId?.wrap) return byId;
	const byPlugin = getProviderByPluginProviderId(needle);
	if (byPlugin?.wrap) return byPlugin;
	return undefined;
}

function primaryWrapLaunch(wrap: NonNullable<ProviderIntegration["wrap"]>): WrapLaunchConfig {
	return {
		binary: wrap.binary,
		kind: wrap.kind,
		...(wrap.args ? { args: wrap.args } : {}),
	};
}

/**
 * Resolve `capa wrap <token>` to a provider + launch config.
 * Matches registry id, pluginProviderId, or a `wrap.aliases` key.
 */
export function resolveWrapTarget(token: string): WrapTarget | undefined {
	const needle = token.trim().toLowerCase();
	if (!needle) return undefined;

	const byId = getProvider(needle);
	if (byId?.wrap) {
		return {
			provider: byId,
			wrap: primaryWrapLaunch(byId.wrap),
			token: needle,
		};
	}

	const byPlugin = getProviderByPluginProviderId(needle);
	if (byPlugin?.wrap) {
		return {
			provider: byPlugin,
			wrap: primaryWrapLaunch(byPlugin.wrap),
			token: needle,
		};
	}

	for (const provider of getWrappableProviders()) {
		const aliases = provider.wrap?.aliases;
		if (!aliases) continue;
		for (const [alias, launch] of Object.entries(aliases)) {
			if (alias.toLowerCase() === needle) {
				return { provider, wrap: launch, token: needle };
			}
		}
	}

	return undefined;
}

/**
 * Human-readable list of wrappable provider ids plus short aliases
 * (pluginProviderId and wrap.aliases keys, excluding the registry id itself).
 */
export function formatWrappableProviderList(): string {
	return getWrappableProviders()
		.map((p) => {
			const extras = new Set<string>();
			if (p.pluginProviderId) {
				extras.add(p.pluginProviderId.toLowerCase());
			}
			for (const alias of Object.keys(p.wrap?.aliases ?? {})) {
				extras.add(alias.toLowerCase());
			}
			extras.delete(p.id.toLowerCase());
			const sorted = [...extras].sort();
			if (sorted.length === 0) return p.id;
			return `${p.id} (alias: ${sorted.join(", ")})`;
		})
		.sort()
		.join(", ");
}

/**
 * Top-level path segment of a project-relative path (e.g. `.cursor/skills` → `.cursor`).
 */
function topLevelName(relPath: string): string {
	const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
	const slash = normalized.indexOf("/");
	return slash === -1 ? normalized : normalized.slice(0, slash);
}

function addProviderOwnedTopLevelNames(
	p: ProviderIntegration,
	names: Set<string>,
): void {
	if (p.skillsDir) names.add(topLevelName(p.skillsDir));
	if (p.instructions?.filename)
		names.add(topLevelName(p.instructions.filename));
	if (p.mcp?.configPath) names.add(topLevelName(p.mcp.configPath));
	if (p.mcp?.defaultMcpFallbackPath)
		names.add(topLevelName(p.mcp.defaultMcpFallbackPath));
	if (p.rules?.dir) names.add(topLevelName(p.rules.dir));
	if (p.subagents?.dir) names.add(topLevelName(p.subagents.dir));
	if (p.hooks?.storage) {
		const storage = p.hooks.storage;
		if (storage.kind === "directory") {
			names.add(topLevelName(storage.dir));
		} else if ("configPath" in storage) {
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
 * the launched wrap provider, every entry in `capabilities.providers`,
 * and any extra ids (e.g. DB-stored install providers, providers detected
 * from existing project dirs like `.cursor`).
 */
export function collectWrapExclusionProviderIds(
	wrapProviderId: string,
	capabilitiesProviders?: string[] | null,
	extraProviderIds?: string[] | null,
): string[] {
	const ids = new Set<string>();
	const wrapId =
		resolveProviderId(wrapProviderId) ?? wrapProviderId.toLowerCase();
	ids.add(wrapId);
	for (const raw of [...(capabilitiesProviders ?? []), ...(extraProviderIds ?? [])]) {
		if (typeof raw !== "string") continue;
		const id = resolveProviderId(raw);
		if (id) ids.add(id);
	}
	return [...ids];
}

/**
 * Providers that already own a top-level path present in `projectPath`
 * (e.g. `.cursor` → cursor). Used so wrap never junctions another agent's
 * config tree into the shadow workspace just because `capabilities.providers`
 * was left empty after an interactive install.
 *
 * Only distinctive paths count: dotted dirs (`.cursor`), instruction/config
 * files (`CLAUDE.md`, `.mcp.json`). Bare names like `skills` are too ambiguous
 * (many projects keep a real `skills/` folder that is not openclaw's).
 */
export function detectProviderIdsFromProjectTree(projectPath: string): string[] {
	const root = resolve(projectPath);
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return [];
	}
	const present = new Set(
		process.platform === "win32"
			? entries.map((e) => e.toLowerCase())
			: entries,
	);
	const found = new Set<string>();
	for (const p of getAllProviders()) {
		const owned = new Set<string>();
		addProviderOwnedTopLevelNames(p, owned);
		for (const name of owned) {
			if (!isDistinctiveProviderTopLevel(name)) continue;
			const key = process.platform === "win32" ? name.toLowerCase() : name;
			if (present.has(key)) {
				found.add(p.id);
				break;
			}
		}
	}
	return [...found];
}

/**
 * True when a top-level name is specific enough to imply a provider is in use.
 * Bare folders like `skills` are project content until a provider is listed in
 * capabilities / the install DB.
 */
function isDistinctiveProviderTopLevel(name: string): boolean {
	if (!name) return false;
	if (name.startsWith(".")) return true;
	const lower = name.toLowerCase();
	return lower.endsWith(".md") || lower.endsWith(".json") || lower.endsWith(".toml");
}

/**
 * Top-level names owned by the given providers (registry id or plugin alias).
 * Used by `capa wrap` so the shadow workspace skips configs that install will
 * write for the launched provider and any providers listed in capabilities.
 */
export function getProviderOwnedTopLevelNames(
	providerIds: Iterable<string>,
): Set<string> {
	const names = new Set<string>();
	for (const raw of providerIds) {
		const id = resolveProviderId(raw) ?? raw.trim().toLowerCase();
		const p = getProvider(id);
		if (!p) continue;
		addProviderOwnedTopLevelNames(p, names);
	}
	return names;
}

export type {
	InstructionsIntegration,
	McpIntegration,
	ProviderIntegration,
	RulesIntegration,
	SubagentsIntegration,
	WrapIntegration,
	WrapLaunchConfig,
} from "../../types/providers";
