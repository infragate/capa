import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { AuthenticatedFetch } from "../../authenticated-fetch";
import { type CachePlatform, getOrCreateSnapshot } from "../../cache";
import { getGitProvider } from "../../git-providers/registry";
import { marketplaceNameToSlug, parseMarketplaceJson } from "./parse";
import { parseGithubOrGitlabUrl } from "./sources";
import type {
	MarketplaceHost,
	MarketplaceMetaFile,
	MarketplaceOrigin,
	ParsedMarketplace,
} from "./types";

const MARKETPLACE_REL_PATH = ".claude-plugin/marketplace.json";

export interface ParsedMarketplaceSource {
	kind: "git" | "json-url";
	origin: MarketplaceOrigin;
	/** For git: owner/repo. For json-url: the HTTPS URL. */
	locator: string;
	ref?: string;
}

/**
 * Parse a user-supplied Claude marketplace source string.
 *
 * Accepted forms:
 *   - `owner/repo` or `owner/repo@ref` (GitHub)
 *   - `https://github.com/owner/repo[.git]` (optional `@ref` via path/tree not used; use owner/repo@ref)
 *   - `https://gitlab.com/group/project`
 *   - Direct HTTPS URL to a `marketplace.json` file
 */
export function parseClaudeMarketplaceSource(
	source: string,
): ParsedMarketplaceSource {
	const trimmed = source.trim();
	if (!trimmed) {
		throw new Error("Marketplace source cannot be empty");
	}

	if (/^https?:\/\//i.test(trimmed)) {
		let u: URL;
		try {
			u = new URL(trimmed);
		} catch {
			throw new Error(`Invalid marketplace URL "${trimmed}"`);
		}
		const isLocalhost =
			u.hostname === "localhost" || u.hostname === "127.0.0.1";
		if (u.protocol !== "https:" && !isLocalhost) {
			throw new Error(
				`Marketplace URL must use HTTPS (got ${u.protocol}//${u.hostname})`,
			);
		}

		const path = u.pathname;
		if (/marketplace\.json$/i.test(path)) {
			// Prefer extracting GitHub/GitLab coords from known raw-content hosts so
			// relative plugin sources remain installable and icons can use avatars.
			if (u.hostname === "raw.githubusercontent.com") {
				const m = path.match(/^\/([^/]+)\/([^/]+)\//);
				if (m) {
					return {
						kind: "json-url",
						locator: trimmed,
						origin: {
							source: trimmed,
							host: "github",
							ownerRepo: `${m[1]}/${m[2]}`,
							baseUrl: "https://github.com",
						},
					};
				}
			}
			const gitlabRaw = path.match(/^\/(.+)\/-\/raw\//);
			if (
				(u.hostname === "gitlab.com" || u.hostname.endsWith(".gitlab.com")) &&
				gitlabRaw
			) {
				return {
					kind: "json-url",
					locator: trimmed,
					origin: {
						source: trimmed,
						host: "gitlab",
						ownerRepo: gitlabRaw[1],
						baseUrl: u.origin,
					},
				};
			}
			return {
				kind: "json-url",
				locator: trimmed,
				origin: {
					source: trimmed,
					host: "other",
					ownerRepo: null,
					baseUrl: u.origin,
				},
			};
		}

		const parsed = parseGithubOrGitlabUrl(trimmed);
		if (!parsed) {
			throw new Error(
				`Unrecognized marketplace URL "${trimmed}". Expected a GitHub/GitLab repo URL ` +
					`or a direct HTTPS link to marketplace.json.`,
			);
		}
		return {
			kind: "git",
			locator: parsed.ownerRepo,
			origin: {
				source: trimmed,
				host: parsed.host,
				ownerRepo: parsed.ownerRepo,
				baseUrl:
					parsed.host === "gitlab" ? "https://gitlab.com" : "https://github.com",
			},
		};
	}

	// Bare owner/repo[@ref]
	const atIdx = trimmed.lastIndexOf("@");
	let ownerRepo = trimmed;
	let ref: string | undefined;
	if (atIdx > 0) {
		ownerRepo = trimmed.slice(0, atIdx);
		ref = trimmed.slice(atIdx + 1);
		if (!ref) {
			throw new Error(
				`Invalid marketplace source "${trimmed}". Empty ref after "@".`,
			);
		}
	}

	if (!/^[^/\s]+\/[^/\s]+$/.test(ownerRepo)) {
		throw new Error(
			`Invalid marketplace source "${trimmed}". Expected "owner/repo" or "owner/repo@ref".`,
		);
	}

	return {
		kind: "git",
		locator: ownerRepo,
		ref,
		origin: {
			source: trimmed,
			host: "github",
			ownerRepo,
			ref,
			baseUrl: "https://github.com",
		},
	};
}

export interface FetchMarketplaceResult {
	catalog: ParsedMarketplace;
	origin: MarketplaceOrigin;
	resolvedRef: string | null;
	/** Preferred registry slug from marketplace name. */
	preferredSlug: string;
	meta: MarketplaceMetaFile;
}

export async function fetchClaudeMarketplace(
	source: string,
	authFetch: AuthenticatedFetch,
	opts: { noCache?: boolean } = {},
): Promise<FetchMarketplaceResult> {
	const parsed = parseClaudeMarketplaceSource(source);

	if (parsed.kind === "json-url") {
		const catalog = await fetchJsonUrl(parsed.locator, authFetch);
		const preferredSlug = marketplaceNameToSlug(catalog.name) || "marketplace";
		const meta: MarketplaceMetaFile = {
			source,
			host: parsed.origin.host,
			ownerRepo: parsed.origin.ownerRepo,
			baseUrl: parsed.origin.baseUrl ?? null,
			marketplaceName: catalog.name,
			pluginCount: catalog.plugins.length,
			fetchedAt: Date.now(),
		};
		return {
			catalog,
			origin: parsed.origin,
			resolvedRef: null,
			preferredSlug,
			meta,
		};
	}

	const host = parsed.origin.host;
	if (host !== "github" && host !== "gitlab") {
		throw new Error(
			`Cannot clone marketplace from host type "${host}". Use a GitHub/GitLab repo or a direct marketplace.json URL.`,
		);
	}
	const snapshot = await snapshotMarketplaceRepo(
		host,
		parsed.locator,
		authFetch,
		{ version: parsed.ref, noCache: opts.noCache },
	);

	const filePath = join(snapshot.snapshotDir, MARKETPLACE_REL_PATH);
	if (!existsSync(filePath)) {
		throw new Error(
			`No ${MARKETPLACE_REL_PATH} found in ${parsed.locator} at ` +
				`${snapshot.resolvedSha.slice(0, 7)}. Is this a Claude marketplace repo?`,
		);
	}

	let data: unknown;
	try {
		data = JSON.parse(readFileSync(filePath, "utf-8"));
	} catch (err: any) {
		throw new Error(
			`Failed to parse ${MARKETPLACE_REL_PATH} from ${parsed.locator}: ${err?.message ?? err}`,
		);
	}

	const catalog = parseMarketplaceJson(data);
	const preferredSlug = marketplaceNameToSlug(catalog.name) || "marketplace";
	const origin: MarketplaceOrigin = {
		...parsed.origin,
		ref: parsed.ref,
	};
	const meta: MarketplaceMetaFile = {
		source,
		host,
		ownerRepo: parsed.locator,
		ref: parsed.ref,
		baseUrl: origin.baseUrl ?? null,
		marketplaceName: catalog.name,
		pluginCount: catalog.plugins.length,
		fetchedAt: Date.now(),
	};

	return {
		catalog,
		origin,
		resolvedRef: snapshot.resolvedSha,
		preferredSlug,
		meta,
	};
}

async function fetchJsonUrl(
	url: string,
	authFetch: AuthenticatedFetch,
): Promise<ParsedMarketplace> {
	let response: Response;
	try {
		response = await authFetch.fetch(url);
	} catch (err: any) {
		throw new Error(`Failed to fetch ${url}: ${err?.message ?? err}`);
	}
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${url}: ${response.status} ${response.statusText}`,
		);
	}
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new Error(`Response from ${url} is not valid JSON`);
	}
	return parseMarketplaceJson(data);
}

async function snapshotMarketplaceRepo(
	platform: "github" | "gitlab",
	repoPath: string,
	authFetch: AuthenticatedFetch,
	opts: { version?: string; noCache?: boolean },
): Promise<{ snapshotDir: string; resolvedSha: string }> {
	const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
	const platformName = getGitProvider(platform as CachePlatform)?.displayName ?? platform;
	try {
		return await getOrCreateSnapshot({
			platform: platform as CachePlatform,
			repoPath,
			authFetch,
			version: opts.version,
			noCache: opts.noCache,
		});
	} catch (err: any) {
		const message: string = err?.stderr || err?.message || "";
		if (
			message.includes("Authentication failed") ||
			message.includes("could not read Username")
		) {
			throw new Error(
				`${platformName} authentication failed for ${repoPath} — token may be expired; ` +
					`run \`capa auth ${platform}.com\` to reconnect.`,
			);
		}
		if (
			message.includes("could not be found") ||
			message.includes("not found") ||
			message.includes("don't have permission")
		) {
			const hint = hasAuth
				? `Check the path, or ensure your ${platformName} token has access.`
				: `Check the path, or connect ${platformName} via \`capa auth ${platform}.com\` if the repo is private.`;
			throw new Error(
				`${platformName} repository not accessible: ${repoPath} — ${hint}`,
			);
		}
		if (
			message.includes("unable to access") ||
			message.includes("Could not resolve host")
		) {
			throw new Error(
				`Network error: cannot reach ${platform}.com — check your internet connection.`,
			);
		}
		throw new Error(
			`Failed to fetch ${repoPath} from ${platformName}: ${message || "Unknown error"}`,
		);
	}
}
