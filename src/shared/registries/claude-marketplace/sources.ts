import type { Plugin } from "../../../types/plugin";
import type {
	InstallCoords,
	MarketplaceOrigin,
	MarketplacePluginEntry,
	MarketplaceSource,
	ParsedMarketplace,
} from "./types";

export function parseGithubOrGitlabUrl(
	url: string,
): { host: "github" | "gitlab"; ownerRepo: string } | null {
	const trimmed = url.trim().replace(/\.git$/, "");

	const ghHttps = trimmed.match(
		/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\/.*)?$/,
	);
	if (ghHttps) return { host: "github", ownerRepo: ghHttps[1] };

	const ghSsh = trimmed.match(/^git@github\.com:([^/\s]+\/[^/\s]+?)$/);
	if (ghSsh) return { host: "github", ownerRepo: ghSsh[1] };

	const glHttps = trimmed.match(
		/^https?:\/\/gitlab\.com\/(.+?)(?:\/-\/.*)?$/,
	);
	if (glHttps) {
		const path = glHttps[1].replace(/\.git$/, "").replace(/\/$/, "");
		if (path.includes("/")) return { host: "gitlab", ownerRepo: path };
	}

	const glSsh = trimmed.match(/^git@gitlab\.com:(.+?)$/);
	if (glSsh) {
		const path = glSsh[1].replace(/\.git$/, "");
		if (path.includes("/")) return { host: "gitlab", ownerRepo: path };
	}

	if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
		return { host: "github", ownerRepo: trimmed };
	}

	return null;
}

function joinPluginRoot(
	pluginRoot: string | undefined,
	relPath: string,
): string {
	const cleaned = relPath.replace(/^\.\/?/, "").replace(/^\/+/, "");
	if (!pluginRoot) return cleaned;
	return `${pluginRoot.replace(/\/+$/, "")}/${cleaned}`;
}

/**
 * Translate a marketplace plugin source into git install coordinates.
 * Returns null for npm/pip/unknown/non-git sources, or when a monorepo-local
 * path has no marketplace origin repo (JSON-URL-only marketplaces).
 */
export function sourceToInstallCoords(
	src: MarketplaceSource,
	origin: MarketplaceOrigin,
	pluginRoot?: string,
): InstallCoords | null {
	switch (src.kind) {
		case "monorepo-local": {
			if (!origin.ownerRepo) return null;
			if (origin.host !== "github" && origin.host !== "gitlab") return null;
			return {
				host: origin.host,
				ownerRepo: origin.ownerRepo,
				subpath: joinPluginRoot(pluginRoot, src.path),
				ref: origin.ref,
			};
		}
		case "git-subdir":
		case "url-with-path": {
			const parsed = parseGithubOrGitlabUrl(src.url);
			if (!parsed) return null;
			return {
				host: parsed.host,
				ownerRepo: parsed.ownerRepo,
				subpath: src.path.replace(/^\/+/, ""),
				sha: src.sha,
				ref: src.ref,
			};
		}
		case "url": {
			const parsed = parseGithubOrGitlabUrl(src.url);
			if (!parsed) return null;
			return {
				host: parsed.host,
				ownerRepo: parsed.ownerRepo,
				sha: src.sha,
				ref: src.ref,
			};
		}
		case "repo": {
			const parsed = parseGithubOrGitlabUrl(src.repo);
			if (!parsed) return null;
			return {
				host: parsed.host,
				ownerRepo: parsed.ownerRepo,
				sha: src.sha ?? src.commit,
				ref: src.ref,
			};
		}
		case "npm":
		case "pip":
		case "unknown":
			return null;
	}
}

/**
 * Prefer exact `owner/repo::subpath` over `owner/repo@name` so install
 * resolution never depends on first-match basename/manifest search.
 */
export function buildRepoString(coords: InstallCoords): string {
	const { ownerRepo, subpath } = coords;
	if (!subpath) return ownerRepo;
	return `${ownerRepo}::${subpath}`;
}

/**
 * Build a capa `plugins:` install snippet, or null when the source cannot
 * be installed via capa (npm/pip/non-git/JSON-only marketplace).
 */
export function buildPluginInstallSnippet(
	plugin: MarketplacePluginEntry,
	catalog: ParsedMarketplace,
	origin: MarketplaceOrigin,
): Plugin | null {
	const coords = sourceToInstallCoords(
		plugin.source,
		origin,
		catalog.pluginRoot,
	);
	if (!coords) return null;

	const def: Plugin["def"] = {
		repo: buildRepoString(coords),
	};
	if (coords.sha) def.ref = coords.sha;
	else if (coords.ref) def.version = coords.ref;
	if (plugin.description) def.description = plugin.description;

	return {
		id: plugin.name,
		type: coords.host,
		def,
	};
}

export function unsupportedSourceReason(
	src: MarketplaceSource,
	origin: MarketplaceOrigin,
): string {
	switch (src.kind) {
		case "npm":
			return `npm package "${src.package}" (capa only installs git-based marketplace plugins)`;
		case "pip":
			return `pip package "${src.package}" (capa only installs git-based marketplace plugins)`;
		case "monorepo-local":
			if (!origin.ownerRepo) {
				return "relative plugin path requires a git-backed marketplace (not a bare marketplace.json URL)";
			}
			return "unresolved monorepo-local source";
		case "unknown":
			return "unrecognized marketplace source shape";
		default:
			return "source does not resolve to a GitHub/GitLab repository";
	}
}
