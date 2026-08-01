import type { Plugin } from "../../../types/plugin";
import type {
	RegistryAdapter,
	RegistryItemDetail,
	RegistryItemSummary,
	RegistryManifest,
} from "../../../types/registry";
import {
	buildPluginInstallSnippet,
	unsupportedSourceReason,
} from "./sources";
import type {
	MarketplaceOrigin,
	MarketplacePluginEntry,
	ParsedMarketplace,
} from "./types";

export interface CreateClaudeMarketplaceAdapterOptions {
	/** Registry slug / manifest id (DB primary key). */
	slug: string;
	catalog: ParsedMarketplace;
	origin: MarketplaceOrigin;
}

function homepageFor(origin: MarketplaceOrigin): string | undefined {
	if (origin.baseUrl && origin.ownerRepo) {
		return `${origin.baseUrl.replace(/\/+$/, "")}/${origin.ownerRepo}`;
	}
	if (!origin.ownerRepo) {
		if (origin.baseUrl) return origin.baseUrl;
		return undefined;
	}
	const host =
		origin.host === "gitlab" ? "https://gitlab.com" : "https://github.com";
	return `${host}/${origin.ownerRepo}`;
}

function browsePluginUrl(
	origin: MarketplaceOrigin,
	plugin: MarketplacePluginEntry,
	subpath?: string,
): string | undefined {
	const base = homepageFor(origin);
	if (!base) return plugin.homepage;
	if (subpath) {
		const ref = origin.ref ?? "main";
		return `${base}/tree/${ref}/${subpath}`;
	}
	return plugin.homepage ?? base;
}

function toSummary(
	plugin: MarketplacePluginEntry,
	installable: boolean,
): RegistryItemSummary {
	const tags: string[] = [];
	if (plugin.category) tags.push(plugin.category);
	if (installable) tags.push("source-resolved");
	else tags.push("source-unsupported");
	return {
		id: plugin.name,
		capability: "plugins",
		title: plugin.name,
		description: plugin.description,
		author: plugin.author?.name,
		version: plugin.version,
		tags: tags.length > 0 ? tags : undefined,
		homepage: plugin.homepage,
	};
}

function buildPreview(
	plugin: MarketplacePluginEntry,
	catalog: ParsedMarketplace,
	origin: MarketplaceOrigin,
	snippet: Plugin | null,
	slug: string,
): string {
	const parts: string[] = [];
	parts.push(`# ${plugin.name}`);
	parts.push("");
	if (plugin.description) {
		parts.push(plugin.description);
		parts.push("");
	}

	const meta: string[] = [];
	meta.push(`**Marketplace:** \`${catalog.name}\``);
	if (catalog.owner?.name) meta.push(`**Owner:** ${catalog.owner.name}`);
	if (plugin.version) meta.push(`**Version:** ${plugin.version}`);
	if (plugin.category) meta.push(`**Category:** ${plugin.category}`);
	if (plugin.author?.name) meta.push(`**Author:** ${plugin.author.name}`);
	if (origin.ownerRepo) {
		const hostLabel =
			origin.host === "gitlab"
				? "GitLab"
				: origin.host === "github"
					? "GitHub"
					: "Git";
		meta.push(`**Marketplace repo:** \`${origin.ownerRepo}\` (${hostLabel})`);
	}
	parts.push(meta.join("  \n"));
	parts.push("");

	parts.push("## Install");
	parts.push("");
	if (snippet) {
		parts.push("Install via capa:");
		parts.push("");
		parts.push("```");
		parts.push(`capa add ${slug}:${plugin.name}`);
		parts.push("```");
		parts.push("");
		parts.push("YAML snippet:");
		parts.push("");
		parts.push("```yaml");
		parts.push(`plugins:`);
		parts.push(`  - id: ${snippet.id}`);
		parts.push(`    type: ${snippet.type}`);
		parts.push(`    def:`);
		parts.push(`      repo: ${snippet.def.repo}`);
		if (snippet.def.version) parts.push(`      version: ${snippet.def.version}`);
		if (snippet.def.ref) parts.push(`      ref: ${snippet.def.ref}`);
		parts.push("```");
	} else {
		parts.push(
			`This plugin cannot be installed via capa: ${unsupportedSourceReason(plugin.source, origin)}.`,
		);
	}

	return parts.join("\n");
}

const DEFAULT_ICON = "https://claude.com/favicon.ico";

/** Resolve a site's `/favicon.ico` from a base URL or any absolute URL. */
export function siteFavicon(url: string): string {
	try {
		const u = new URL(url);
		if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_ICON;
		return `${u.origin}/favicon.ico`;
	} catch {
		return DEFAULT_ICON;
	}
}

/**
 * Registry tab icon for a Claude marketplace.
 *
 * - GitHub with a known owner → owner avatar
 * - Anything else with a site origin → that site's favicon
 * - Last resort → Claude favicon
 */
export function marketplaceIcon(origin: MarketplaceOrigin): string {
	if (origin.host === "github" && origin.ownerRepo) {
		const owner = origin.ownerRepo.split("/")[0];
		if (owner) return `https://github.com/${owner}.png?size=64`;
	}

	if (origin.baseUrl) {
		return siteFavicon(origin.baseUrl);
	}

	if (/^https?:\/\//i.test(origin.source)) {
		return siteFavicon(origin.source);
	}

	if (origin.host === "gitlab") {
		return siteFavicon("https://gitlab.com");
	}

	return DEFAULT_ICON;
}

/**
 * Build an in-process RegistryAdapter from a cached Claude marketplace catalog.
 */
export function createClaudeMarketplaceAdapter(
	opts: CreateClaudeMarketplaceAdapterOptions,
): RegistryAdapter {
	const { slug, catalog, origin } = opts;
	const byName = new Map(catalog.plugins.map((p) => [p.name, p]));

	const displayName = catalog.name;
	const description =
		catalog.description ??
		`Claude marketplace with ${catalog.plugins.length} plugin(s)`;

	const manifest: RegistryManifest = {
		id: slug,
		name: displayName,
		description,
		homepage: homepageFor(origin),
		icon: marketplaceIcon(origin),
		capabilities: ["plugins"],
	};

	const adapter: RegistryAdapter = {
		manifest,

		async search({ capability, query, limit }) {
			if (capability !== "plugins") {
				return { items: [], total: 0 };
			}
			const q = (query ?? "").trim().toLowerCase();
			const filtered = q
				? catalog.plugins.filter((p) => pluginMatches(p, q))
				: catalog.plugins;

			const total = filtered.length;
			const sliced =
				typeof limit === "number" && limit > 0
					? filtered.slice(0, limit)
					: filtered;

			return {
				items: sliced.map((p) => {
					const snippet = buildPluginInstallSnippet(p, catalog, origin);
					return toSummary(p, snippet != null);
				}),
				total,
			};
		},

		async view({ capability, id }): Promise<RegistryItemDetail> {
			if (capability !== "plugins") {
				throw new Error(
					`Unsupported capability for Claude marketplace "${slug}": ${capability}`,
				);
			}
			const plugin = byName.get(id);
			if (!plugin) {
				throw new Error(
					`Plugin "${id}" not found in marketplace "${catalog.name}"`,
				);
			}

			const snippet = buildPluginInstallSnippet(plugin, catalog, origin);
			if (!snippet) {
				throw new Error(
					`Plugin "${id}" cannot be installed via capa: ${unsupportedSourceReason(plugin.source, origin)}.`,
				);
			}

			const summary = toSummary(plugin, true);
			summary.homepage =
				plugin.homepage ??
				browsePluginUrl(origin, plugin, undefined) ??
				summary.homepage;

			return {
				...summary,
				preview: buildPreview(plugin, catalog, origin, snippet, slug),
				installSnippet: snippet,
			};
		},
	};

	return adapter;
}

function pluginMatches(plugin: MarketplacePluginEntry, q: string): boolean {
	if (plugin.name.toLowerCase().includes(q)) return true;
	if (plugin.description?.toLowerCase().includes(q)) return true;
	if (plugin.category?.toLowerCase().includes(q)) return true;
	if (plugin.author?.name?.toLowerCase().includes(q)) return true;
	return false;
}
