/**
 * Parsed Claude Code marketplace catalog (`.claude-plugin/marketplace.json`).
 */

export type MarketplaceHost = "github" | "gitlab" | "other";

/** Normalized plugin `source` field from marketplace.json. */
export type MarketplaceSource =
	| { kind: "monorepo-local"; path: string }
	| {
			kind: "git-subdir";
			url: string;
			path: string;
			ref?: string;
			sha?: string;
	  }
	| { kind: "url"; url: string; ref?: string; sha?: string }
	| {
			kind: "url-with-path";
			url: string;
			path: string;
			ref?: string;
			sha?: string;
	  }
	| { kind: "repo"; repo: string; ref?: string; sha?: string; commit?: string }
	| { kind: "npm"; package: string; version?: string }
	| { kind: "pip"; package: string; version?: string }
	| { kind: "unknown"; raw: unknown };

export interface MarketplaceOwner {
	name?: string;
	email?: string;
	url?: string;
}

export interface MarketplacePluginEntry {
	name: string;
	description?: string;
	version?: string;
	author?: MarketplaceOwner;
	category?: string;
	homepage?: string;
	source: MarketplaceSource;
	raw: Record<string, unknown>;
}

export interface ParsedMarketplace {
	name: string;
	description?: string;
	version?: string;
	owner?: MarketplaceOwner;
	/** Base directory prepended to relative plugin sources. */
	pluginRoot?: string;
	plugins: MarketplacePluginEntry[];
	raw: Record<string, unknown>;
}

/**
 * Where the marketplace catalog was fetched from — needed so monorepo-local
 * plugin sources can be turned into capa `def.repo` strings.
 */
export interface MarketplaceOrigin {
	/** Original user-supplied source string. */
	source: string;
	host: MarketplaceHost;
	/**
	 * `owner/repo` for git-backed marketplaces. Null when the catalog was
	 * fetched from a bare JSON URL (relative plugin sources cannot install).
	 */
	ownerRepo: string | null;
	/** Optional branch/tag from `owner/repo@ref`. */
	ref?: string;
	/**
	 * Browseable site origin used for favicon fallback
	 * (e.g. `https://github.com`, `https://gitlab.com`, `https://git.example.com`).
	 */
	baseUrl?: string | null;
}

/** Persisted next to marketplace.json under the managed registries dir. */
export interface MarketplaceMetaFile {
	source: string;
	host: MarketplaceHost;
	ownerRepo: string | null;
	ref?: string;
	/** Site origin for favicon fallback; may be absent on older meta files. */
	baseUrl?: string | null;
	marketplaceName: string;
	pluginCount: number;
	fetchedAt: number;
}

/** Git coordinates capa can install from. */
export interface InstallCoords {
	host: "github" | "gitlab";
	ownerRepo: string;
	subpath?: string;
	sha?: string;
	ref?: string;
}
