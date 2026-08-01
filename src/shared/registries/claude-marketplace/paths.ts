import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { CapaDatabase } from "../../../db/database";
import type { RegistryAdapter } from "../../../types/registry";
import { createAuthenticatedFetch } from "../../authenticated-fetch";
import { getOrCreateSnapshot } from "../../cache";
import { getManagedRegistriesDir } from "../../config";
import { logger } from "../../logger";
import { detectAndParseManifest } from "../../plugin-manifest";
import { createClaudeMarketplaceAdapter } from "./adapter";
import { summarizeUnifiedManifest } from "./plugin-contents";
import { parseMarketplaceJson } from "./parse";
import type {
	InstallCoords,
	MarketplaceMetaFile,
	MarketplaceOrigin,
} from "./types";

export const MARKETPLACE_JSON_FILENAME = "marketplace.json";
export const MARKETPLACE_META_FILENAME = "marketplace.meta.json";

const inspectLog = logger.child("claude-marketplace");

export function getMarketplaceManagedDir(slug: string): string {
	return join(getManagedRegistriesDir(), slug);
}

export function getInstalledMarketplacePath(slug: string): string | null {
	const candidate = join(
		getMarketplaceManagedDir(slug),
		MARKETPLACE_JSON_FILENAME,
	);
	return existsSync(candidate) ? candidate : null;
}

export function getInstalledMarketplaceMetaPath(slug: string): string | null {
	const candidate = join(
		getMarketplaceManagedDir(slug),
		MARKETPLACE_META_FILENAME,
	);
	return existsSync(candidate) ? candidate : null;
}

/**
 * Clone (or reuse cache) the plugin repo and summarize what capa unpacks.
 * Returns null on any failure so marketplace preview still works without contents.
 */
export function createPluginInspector(db: CapaDatabase) {
	const authFetch = createAuthenticatedFetch(db);

	return async (coords: InstallCoords) => {
		try {
			const snapshot = await getOrCreateSnapshot({
				platform: coords.host,
				repoPath: coords.ownerRepo,
				authFetch,
				version: coords.ref,
				ref: coords.sha,
			});
			const root = coords.subpath
				? join(snapshot.snapshotDir, coords.subpath)
				: snapshot.snapshotDir;
			if (!existsSync(root)) {
				inspectLog.debug(
					`Plugin inspect: path missing ${coords.ownerRepo}/${coords.subpath ?? ""}`,
				);
				return null;
			}
			const manifest = detectAndParseManifest(root, [
				"claude-code",
				"cursor",
			]);
			if (!manifest) return null;
			return summarizeUnifiedManifest(manifest);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			inspectLog.debug(
				`Plugin inspect failed for ${coords.ownerRepo}: ${message}`,
			);
			return null;
		}
	};
}

/**
 * Load a previously materialized Claude marketplace into a RegistryAdapter.
 */
export function loadClaudeMarketplaceAdapter(
	slug: string,
	opts: { db?: CapaDatabase } = {},
): RegistryAdapter {
	const jsonPath = getInstalledMarketplacePath(slug);
	if (!jsonPath) {
		throw new Error(
			`No materialized marketplace.json for slug "${slug}"; run \`capa registry refresh ${slug}\`.`,
		);
	}
	const metaPath = getInstalledMarketplaceMetaPath(slug);
	if (!metaPath) {
		throw new Error(
			`No marketplace.meta.json for slug "${slug}"; run \`capa registry refresh ${slug}\`.`,
		);
	}

	let catalogRaw: unknown;
	let meta: MarketplaceMetaFile;
	try {
		catalogRaw = JSON.parse(readFileSync(jsonPath, "utf-8"));
	} catch (err: any) {
		throw new Error(
			`Failed to read marketplace.json for "${slug}": ${err?.message ?? err}`,
		);
	}
	try {
		meta = JSON.parse(readFileSync(metaPath, "utf-8")) as MarketplaceMetaFile;
	} catch (err: any) {
		throw new Error(
			`Failed to read marketplace.meta.json for "${slug}": ${err?.message ?? err}`,
		);
	}

	const catalog = parseMarketplaceJson(catalogRaw);
	const origin: MarketplaceOrigin = {
		source: meta.source,
		host: meta.host,
		ownerRepo: meta.ownerRepo,
		ref: meta.ref,
		baseUrl:
			meta.baseUrl ??
			(meta.host === "gitlab"
				? "https://gitlab.com"
				: meta.host === "github"
					? "https://github.com"
					: null),
	};

	return createClaudeMarketplaceAdapter({
		slug,
		catalog,
		origin,
		inspectPlugin: opts.db ? createPluginInspector(opts.db) : undefined,
	});
}
