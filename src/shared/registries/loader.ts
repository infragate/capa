import { statSync } from "fs";
import type { CapaDatabase } from "../../db/database";
import type { RegistryAdapter } from "../../types/registry";
import { logger } from "../logger";
import {
	getInstalledMarketplaceMetaPath,
	getInstalledMarketplacePath,
	loadClaudeMarketplaceAdapter,
} from "./claude-marketplace";
import { getInstalledAdapterPath } from "./installer";

interface LoadedRegistry {
	adapter: RegistryAdapter;
	slug: string;
	mtime: number;
	/** marketplace.meta.json mtime; only set for Claude marketplaces. */
	metaMtime?: number;
	updatedAt: number;
}

export interface RegistryLoadFailure {
	slug: string;
	error: string;
}

export interface RegistryLoadResult {
	adapters: Map<string, RegistryAdapter>;
	failures?: RegistryLoadFailure[];
}

const registryLogger = logger.child("Registries");

function isValidAdapter(obj: unknown): obj is RegistryAdapter {
	if (!obj || typeof obj !== "object") return false;
	const a = obj as Record<string, unknown>;
	if (!a.manifest || typeof a.manifest !== "object") return false;
	const m = a.manifest as Record<string, unknown>;
	return (
		typeof m.id === "string" &&
		m.id.length > 0 &&
		typeof m.name === "string" &&
		m.name.length > 0 &&
		Array.isArray(m.capabilities) &&
		m.capabilities.length > 0 &&
		typeof a.search === "function" &&
		typeof a.view === "function"
	);
}

/**
 * Loads registry adapters whose DB row is `enabled = true` and
 * `status = 'installed'`. Adapter registries are dynamic-imported from
 * materialized `adapter.*` files; Claude marketplaces are built in-process
 * from cached `marketplace.json`.
 */
export class RegistryLoader {
	private cache = new Map<string, LoadedRegistry>();

	constructor(private db: CapaDatabase) {}

	async loadAll(): Promise<RegistryLoadResult> {
		const records = this.db
			.listRegistries()
			.filter((r) => r.enabled && r.status === "installed");

		const adapters = new Map<string, RegistryAdapter>();
		const failures: RegistryLoadFailure[] = [];
		const seenIds = new Set<string>();
		const activeSlugs = new Set<string>();

		for (const record of records) {
			activeSlugs.add(record.slug);

			if (record.type === "claude-marketplace") {
				await this.loadMarketplaceRecord(
					record,
					adapters,
					failures,
					seenIds,
				);
				continue;
			}

			const adapterPath = getInstalledAdapterPath(record.slug);
			if (!adapterPath) {
				failures.push({
					slug: record.slug,
					error: `No materialized adapter file for slug "${record.slug}"; run \`capa registry refresh ${record.slug}\`.`,
				});
				continue;
			}

			let mtime: number;
			try {
				mtime = statSync(adapterPath).mtimeMs;
			} catch (err: any) {
				failures.push({
					slug: record.slug,
					error: `Cannot stat ${adapterPath}: ${err?.message ?? err}`,
				});
				continue;
			}

			const cached = this.cache.get(record.slug);
			if (
				cached &&
				cached.mtime === mtime &&
				cached.updatedAt === record.updatedAt
			) {
				const id = cached.adapter.manifest.id;
				if (seenIds.has(id)) {
					registryLogger.warn(
						`Duplicate registry id "${id}" from slug "${record.slug}", skipping`,
					);
					continue;
				}
				seenIds.add(id);
				adapters.set(id, cached.adapter);
				continue;
			}

			try {
				const moduleUrl = `file://${adapterPath.replace(/\\/g, "/")}?t=${mtime}`;
				const module = await import(moduleUrl);
				const adapter: unknown = module.default ?? module;

				if (!isValidAdapter(adapter)) {
					const msg =
						`Adapter for slug "${record.slug}" does not export a valid RegistryAdapter ` +
						`(needs default export with { manifest, search, view }).`;
					registryLogger.warn(msg);
					failures.push({ slug: record.slug, error: msg });
					continue;
				}

				const id = adapter.manifest.id;
				if (seenIds.has(id)) {
					const msg = `Duplicate registry id "${id}" from slug "${record.slug}"; skipping.`;
					registryLogger.warn(msg);
					failures.push({ slug: record.slug, error: msg });
					continue;
				}

				seenIds.add(id);
				this.cache.set(record.slug, {
					adapter,
					slug: record.slug,
					mtime,
					updatedAt: record.updatedAt,
				});
				adapters.set(id, adapter);
				registryLogger.info(
					`Loaded registry "${id}" from slug "${record.slug}"`,
				);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				registryLogger.warn(
					`Failed to load registry adapter for slug "${record.slug}": ${message}`,
				);
				failures.push({ slug: record.slug, error: message });
			}
		}

		for (const slug of [...this.cache.keys()]) {
			if (!activeSlugs.has(slug)) {
				this.cache.delete(slug);
			}
		}

		return failures.length > 0 ? { adapters, failures } : { adapters };
	}

	private async loadMarketplaceRecord(
		record: {
			slug: string;
			updatedAt: number;
		},
		adapters: Map<string, RegistryAdapter>,
		failures: RegistryLoadFailure[],
		seenIds: Set<string>,
	): Promise<void> {
		const jsonPath = getInstalledMarketplacePath(record.slug);
		if (!jsonPath) {
			failures.push({
				slug: record.slug,
				error: `No materialized marketplace.json for slug "${record.slug}"; run \`capa registry refresh ${record.slug}\`.`,
			});
			return;
		}

		const metaPath = getInstalledMarketplaceMetaPath(record.slug);
		if (!metaPath) {
			failures.push({
				slug: record.slug,
				error: `No marketplace.meta.json for slug "${record.slug}"; run \`capa registry refresh ${record.slug}\`.`,
			});
			return;
		}

		let mtime: number;
		let metaMtime: number;
		try {
			mtime = statSync(jsonPath).mtimeMs;
			metaMtime = statSync(metaPath).mtimeMs;
		} catch (err: any) {
			failures.push({
				slug: record.slug,
				error: `Cannot stat marketplace files for "${record.slug}": ${err?.message ?? err}`,
			});
			return;
		}

		const cached = this.cache.get(record.slug);
		if (
			cached &&
			cached.mtime === mtime &&
			cached.metaMtime === metaMtime &&
			cached.updatedAt === record.updatedAt
		) {
			const id = cached.adapter.manifest.id;
			if (seenIds.has(id)) {
				registryLogger.warn(
					`Duplicate registry id "${id}" from slug "${record.slug}", skipping`,
				);
				return;
			}
			seenIds.add(id);
			adapters.set(id, cached.adapter);
			return;
		}

		try {
			const adapter = loadClaudeMarketplaceAdapter(record.slug, {
				db: this.db,
			});
			if (!isValidAdapter(adapter)) {
				const msg = `Claude marketplace for slug "${record.slug}" produced an invalid RegistryAdapter.`;
				registryLogger.warn(msg);
				failures.push({ slug: record.slug, error: msg });
				return;
			}

			const id = adapter.manifest.id;
			if (seenIds.has(id)) {
				const msg = `Duplicate registry id "${id}" from slug "${record.slug}"; skipping.`;
				registryLogger.warn(msg);
				failures.push({ slug: record.slug, error: msg });
				return;
			}

			seenIds.add(id);
			this.cache.set(record.slug, {
				adapter,
				slug: record.slug,
				mtime,
				metaMtime,
				updatedAt: record.updatedAt,
			});
			adapters.set(id, adapter);
			registryLogger.info(
				`Loaded Claude marketplace "${id}" from slug "${record.slug}"`,
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			registryLogger.warn(
				`Failed to load Claude marketplace for slug "${record.slug}": ${message}`,
			);
			failures.push({ slug: record.slug, error: message });
		}
	}
}
