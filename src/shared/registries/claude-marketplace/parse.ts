import type {
	MarketplaceOwner,
	MarketplacePluginEntry,
	MarketplaceSource,
	ParsedMarketplace,
} from "./types";

function asOwner(raw: unknown): MarketplaceOwner | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const o = raw as Record<string, unknown>;
	const name = typeof o.name === "string" ? o.name : undefined;
	const email = typeof o.email === "string" ? o.email : undefined;
	const url = typeof o.url === "string" ? o.url : undefined;
	if (!name && !email && !url) return undefined;
	return { name, email, url };
}

/**
 * Classify a marketplace.json plugin `source` field into a tagged union.
 */
export function classifyMarketplaceSource(raw: unknown): MarketplaceSource {
	if (typeof raw === "string") {
		return { kind: "monorepo-local", path: raw.replace(/^\.\/?/, "") };
	}
	if (raw && typeof raw === "object") {
		const o = raw as Record<string, unknown>;
		const sourceTag = typeof o.source === "string" ? o.source : undefined;
		const url = typeof o.url === "string" ? o.url : undefined;
		const path = typeof o.path === "string" ? o.path : undefined;
		const ref = typeof o.ref === "string" ? o.ref : undefined;
		const sha = typeof o.sha === "string" ? o.sha : undefined;
		const repo = typeof o.repo === "string" ? o.repo : undefined;
		const commit = typeof o.commit === "string" ? o.commit : undefined;
		const pkg = typeof o.package === "string" ? o.package : undefined;
		const version = typeof o.version === "string" ? o.version : undefined;

		if (sourceTag === "npm" && pkg) {
			return { kind: "npm", package: pkg, version };
		}
		if (sourceTag === "pip" && pkg) {
			return { kind: "pip", package: pkg, version };
		}
		if (sourceTag === "git-subdir" && url && path) {
			return { kind: "git-subdir", url, path, ref, sha };
		}
		if (sourceTag === "github" && repo) {
			return { kind: "repo", repo, ref, sha, commit };
		}
		if (sourceTag === "url" && url && path) {
			return { kind: "url-with-path", url, path, ref, sha };
		}
		if (sourceTag === "url" && url) {
			return { kind: "url", url, ref, sha };
		}
		// Untagged shapes seen in the wild.
		if (url && path) {
			return { kind: "url-with-path", url, path, ref, sha };
		}
		if (url) {
			return { kind: "url", url, ref, sha };
		}
		if (repo) {
			return { kind: "repo", repo, ref, sha, commit };
		}
	}
	return { kind: "unknown", raw };
}

/**
 * Parse and validate a Claude marketplace.json document.
 * @throws if required fields are missing or malformed.
 */
export function parseMarketplaceJson(data: unknown): ParsedMarketplace {
	if (!data || typeof data !== "object") {
		throw new Error("marketplace.json must be a JSON object");
	}
	const root = data as Record<string, unknown>;
	const name = typeof root.name === "string" ? root.name.trim() : "";
	if (!name) {
		throw new Error('marketplace.json is missing required field "name"');
	}

	const pluginsRaw = root.plugins;
	if (!Array.isArray(pluginsRaw)) {
		throw new Error('marketplace.json is missing required field "plugins" (array)');
	}

	const metadata =
		root.metadata && typeof root.metadata === "object"
			? (root.metadata as Record<string, unknown>)
			: undefined;
	const pluginRootRaw =
		typeof metadata?.pluginRoot === "string" ? metadata.pluginRoot : undefined;
	const pluginRoot = pluginRootRaw
		? pluginRootRaw.replace(/^\.\/?/, "").replace(/\/+$/, "")
		: undefined;

	const plugins: MarketplacePluginEntry[] = [];
	for (const p of pluginsRaw) {
		if (!p || typeof p !== "object") continue;
		const entry = p as Record<string, unknown>;
		const pluginName =
			typeof entry.name === "string" ? entry.name.trim() : "";
		if (!pluginName) continue;
		if (entry.source === undefined || entry.source === null) {
			throw new Error(
				`marketplace.json plugin "${pluginName}" is missing required field "source"`,
			);
		}
		plugins.push({
			name: pluginName,
			description:
				typeof entry.description === "string" ? entry.description : undefined,
			version: typeof entry.version === "string" ? entry.version : undefined,
			author: asOwner(entry.author),
			category: typeof entry.category === "string" ? entry.category : undefined,
			homepage: typeof entry.homepage === "string" ? entry.homepage : undefined,
			source: classifyMarketplaceSource(entry.source),
			raw: entry,
		});
	}

	if (plugins.length === 0) {
		throw new Error("marketplace.json has no valid plugins");
	}

	return {
		name,
		description:
			typeof root.description === "string" ? root.description : undefined,
		version: typeof root.version === "string" ? root.version : undefined,
		owner: asOwner(root.owner),
		pluginRoot,
		plugins,
		raw: root,
	};
}

/** Sanitize a marketplace `name` into a capa registry slug candidate. */
export function marketplaceNameToSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
