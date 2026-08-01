import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getManagedRegistriesDir } from "../../config";
import { createClaudeMarketplaceAdapter } from "./adapter";
import { parseMarketplaceJson } from "./parse";
import type { MarketplaceMetaFile, MarketplaceOrigin } from "./types";
import type { RegistryAdapter } from "../../../types/registry";

export const MARKETPLACE_JSON_FILENAME = "marketplace.json";
export const MARKETPLACE_META_FILENAME = "marketplace.meta.json";

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
 * Load a previously materialized Claude marketplace into a RegistryAdapter.
 */
export function loadClaudeMarketplaceAdapter(slug: string): RegistryAdapter {
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

	return createClaudeMarketplaceAdapter({ slug, catalog, origin });
}
