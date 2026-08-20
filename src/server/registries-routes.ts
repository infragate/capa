import type { CapaDatabase } from "../db/database";
import { createAuthenticatedFetch } from "../shared/authenticated-fetch";
import { logger } from "../shared/logger";
import {
	deriveSlug,
	executeStagedRegistry,
	fetchAdapterSource,
	isValidSlug,
	removeInstalledAdapter,
	stageRegistry,
} from "../shared/registries/installer";
import type { RegistryManager } from "../shared/registries/manager";
import type { RegistrySourceType } from "../types/database";
import type { RegistryCapability, RegistryManifest } from "../types/registry";
import { clientErrorMessage } from "./http-error";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonError(message: string, status: number): Response {
	const safe = message.split("\n", 1)[0]?.slice(0, 500) || "Request failed";
	return new Response(JSON.stringify({ error: safe }), {
		status,
		headers: JSON_HEADERS,
	});
}

function jsonOk(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parseTypeQuery(value: string | null): RegistrySourceType | null {
	if (
		value === "github" ||
		value === "gitlab" ||
		value === "url" ||
		value === "claude-marketplace"
	) {
		return value;
	}
	return null;
}

const TYPE_HELP = "github, gitlab, url, claude-marketplace";

type RegistryInstallInput = {
	slug: string;
	type: RegistrySourceType;
	source: string;
};

/** Stage adapter bytes, execute (import), persist as installed — web UI is explicit approval. */
async function stageAndInstallRegistry(
	db: CapaDatabase,
	manager: RegistryManager,
	input: RegistryInstallInput,
	authFetch: ReturnType<typeof createAuthenticatedFetch>,
	opts: { enabled?: boolean; noCache?: boolean } = {},
) {
	const result = await stageRegistry(input, authFetch, opts);
	try {
		await executeStagedRegistry(input.slug, result.contentSha256);
	} catch (err: any) {
		const message = clientErrorMessage(err);
		db.upsertRegistry({
			slug: input.slug,
			type: input.type,
			source: input.source,
			status: "failed",
			enabled: opts.enabled ?? true,
			lastError: message,
			resolvedRef: result.resolvedRef,
			installedAt: null,
			contentSha256: result.contentSha256,
		});
		await manager.reload().catch(() => {});
		throw new Error(message);
	}

	const record = db.upsertRegistry({
		slug: input.slug,
		type: input.type,
		source: input.source,
		status: "installed",
		enabled: opts.enabled ?? true,
		lastError: null,
		resolvedRef: result.resolvedRef,
		installedAt: Date.now(),
		contentSha256: result.contentSha256,
	});
	await manager.reload().catch(() => {});
	return record;
}

export async function listRegistriesHandler(
	db: CapaDatabase,
	manager: RegistryManager,
): Promise<Response> {
	const records = db.listRegistries();
	let manifests: RegistryManifest[];
	try {
		manifests = await manager.list();
	} catch {
		manifests = [];
	}
	const manifestById = new Map(manifests.map((m) => [m.id, m]));
	const enriched = records.map((r) => ({
		...r,
		manifest: manifestById.get(r.slug) ?? null,
	}));
	return jsonOk({ registries: enriched });
}

export async function createRegistryHandler(
	db: CapaDatabase,
	manager: RegistryManager,
	request: Request,
): Promise<Response> {
	let body: { slug?: string; type?: string; source?: string };
	try {
		body = (await request.json()) as {
			slug?: string;
			type?: string;
			source?: string;
		};
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const type = parseTypeQuery(body.type ?? null);
	if (!type) {
		return jsonError(`Field "type" must be one of: ${TYPE_HELP}.`, 400);
	}
	const source = body.source;
	if (!source || typeof source !== "string") {
		return jsonError('Field "source" is required.', 400);
	}

	let installSlug: string;
	try {
		installSlug = body.slug?.trim() || deriveSlug(source, type);
	} catch (err: any) {
		return jsonError(
			`Cannot derive slug: ${clientErrorMessage(err, "invalid source")}`,
			400,
		);
	}
	if (!isValidSlug(installSlug)) {
		return jsonError(
			`Invalid slug "${installSlug}". Allowed: lowercase letters, digits, and dashes; must start with a letter or digit.`,
			400,
		);
	}

	try {
		const authFetch = createAuthenticatedFetch(db);

		// Prefer marketplace.json `name` as the slug when the caller omitted one.
		if (type === "claude-marketplace" && !body.slug?.trim()) {
			const preview = await fetchAdapterSource({ type, source }, authFetch);
			if (preview.preferredSlug && isValidSlug(preview.preferredSlug)) {
				installSlug = preview.preferredSlug;
			}
		}

		if (db.getRegistry(installSlug)) {
			return jsonError(`Registry "${installSlug}" already exists.`, 409);
		}

		const record = await stageAndInstallRegistry(
			db,
			manager,
			{ slug: installSlug, type, source },
			authFetch,
		);
		return jsonOk({ registry: record });
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function deleteRegistryHandler(
	db: CapaDatabase,
	manager: RegistryManager,
	slug: string,
): Promise<Response> {
	if (!db.getRegistry(slug)) {
		return jsonError(`Registry "${slug}" not found.`, 404);
	}
	db.deleteRegistry(slug);
	removeInstalledAdapter(slug);
	await manager.reload().catch(() => {});
	return new Response(null, { status: 204 });
}

export async function patchRegistryHandler(
	db: CapaDatabase,
	manager: RegistryManager,
	slug: string,
	request: Request,
): Promise<Response> {
	const existing = db.getRegistry(slug);
	if (!existing) {
		return jsonError(`Registry "${slug}" not found.`, 404);
	}
	let body: { enabled?: boolean; type?: string; source?: string };
	try {
		body = (await request.json()) as {
			enabled?: boolean;
			type?: string;
			source?: string;
		};
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const hasEnabled = typeof body.enabled === "boolean";
	const hasType = typeof body.type === "string";
	const hasSource = typeof body.source === "string";

	if (!hasEnabled && !hasType && !hasSource) {
		return jsonError(
			'Provide at least one of: "enabled" (boolean), "type", "source".',
			400,
		);
	}

	// Source / type changes require re-running the installer so the
	// materialized adapter matches the new upstream pointer.
	const newType = hasType ? parseTypeQuery(body.type!) : existing.type;
	if (hasType && !newType) {
		return jsonError(`Field "type" must be one of: ${TYPE_HELP}.`, 400);
	}
	const newSource = hasSource ? body.source!.trim() : existing.source;
	if (hasSource && !newSource) {
		return jsonError('Field "source" cannot be empty.', 400);
	}

	const typeChanged = hasType && newType !== existing.type;
	const sourceChanged = hasSource && newSource !== existing.source;
	const needsReinstall = typeChanged || sourceChanged;

	if (needsReinstall) {
		try {
			const authFetch = createAuthenticatedFetch(db);
			const record = await stageAndInstallRegistry(
				db,
				manager,
				{ slug, type: newType!, source: newSource },
				authFetch,
				{ enabled: hasEnabled ? body.enabled! : existing.enabled },
			);
			return jsonOk({ registry: record });
		} catch (err: any) {
			const message = clientErrorMessage(err);
			// Persist the new pointer so the user can fix and retry, but mark
			// the row failed so the loader stops serving the broken adapter.
			db.upsertRegistry({
				slug,
				type: newType!,
				source: newSource,
				status: "failed",
				enabled: hasEnabled ? body.enabled! : existing.enabled,
				lastError: message,
				resolvedRef: existing.resolvedRef,
				installedAt: existing.installedAt,
			});
			await manager.reload().catch(() => {});
			return jsonError(message, 400);
		}
	}

	if (hasEnabled) {
		db.setRegistryEnabled(slug, body.enabled!);
		await manager.reload().catch(() => {});
	}
	return jsonOk({ registry: db.getRegistry(slug) });
}

export async function refreshRegistryHandler(
	db: CapaDatabase,
	manager: RegistryManager,
	slug: string,
): Promise<Response> {
	const existing = db.getRegistry(slug);
	if (!existing) {
		return jsonError(`Registry "${slug}" not found.`, 404);
	}
	try {
		const authFetch = createAuthenticatedFetch(db);
		const record = await stageAndInstallRegistry(
			db,
			manager,
			{ slug: existing.slug, type: existing.type, source: existing.source },
			authFetch,
		);
		return jsonOk({ registry: record });
	} catch (err: any) {
		const message = clientErrorMessage(err);
		db.setRegistryStatus(slug, "failed", message);
		return new Response(JSON.stringify({ error: message, slug }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
}

export async function previewRegistryHandler(
	db: CapaDatabase,
	url: URL,
): Promise<Response> {
	const type = parseTypeQuery(url.searchParams.get("type"));
	const source = url.searchParams.get("source");
	if (!type) {
		return jsonError(`Query "type" must be one of: ${TYPE_HELP}.`, 400);
	}
	if (!source) {
		return jsonError('Query "source" is required.', 400);
	}
	try {
		const authFetch = createAuthenticatedFetch(db);
		const { content, resolvedRef, preferredSlug, pluginCount } =
			await fetchAdapterSource({ type, source }, authFetch);
		let derivedSlug: string | null = null;
		try {
			const candidate =
				(preferredSlug && isValidSlug(preferredSlug) ? preferredSlug : null) ??
				deriveSlug(source, type);
			derivedSlug = isValidSlug(candidate) ? candidate : null;
		} catch {
			derivedSlug = null;
		}
		return jsonOk({
			content,
			resolvedRef,
			derivedSlug,
			...(typeof pluginCount === "number" ? { pluginCount } : {}),
		});
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export interface RegistriesRouteDeps {
	db: CapaDatabase;
	registryManager: RegistryManager;
}

const apiLogger = () => logger.child("CapaServer").child("API");

export async function searchRegistryHandler(
	manager: RegistryManager,
	registryId: string,
	url: URL,
): Promise<Response> {
	const log = apiLogger();
	log.info(`Registry search: ${registryId}`);
	try {
		const capability = (url.searchParams.get("capability") ??
			"skills") as RegistryCapability;
		const query = url.searchParams.get("q") ?? undefined;
		const limit = url.searchParams.has("limit")
			? Number(url.searchParams.get("limit"))
			: undefined;
		const cursor = url.searchParams.get("cursor") ?? undefined;

		const result = await manager.search(registryId, {
			capability,
			query,
			limit,
			cursor,
		});
		return jsonOk(result);
	} catch (error: any) {
		log.failure(`Registry search error: ${error.message}`);
		const status = error.message.includes("not found") ? 404 : 502;
		return new Response(
			JSON.stringify({ error: error.message, registry: registryId }),
			{ status, headers: JSON_HEADERS },
		);
	}
}

export async function viewRegistryHandler(
	manager: RegistryManager,
	registryId: string,
	itemId: string,
	url: URL,
): Promise<Response> {
	const log = apiLogger();
	log.info(`Registry view: ${registryId} / ${itemId}`);
	try {
		const capability = (url.searchParams.get("capability") ??
			"skills") as RegistryCapability;
		const detail = await manager.view(registryId, {
			capability,
			id: itemId,
		});
		return jsonOk(detail);
	} catch (error: any) {
		log.failure(`Registry view error: ${error.message}`);
		const status = error.message.includes("not found") ? 404 : 502;
		return new Response(
			JSON.stringify({ error: error.message, registry: registryId }),
			{ status, headers: JSON_HEADERS },
		);
	}
}

/**
 * Dispatcher for `/api/registries…` routes.
 * Returns null if the path is not a registries route.
 */
export async function dispatchRegistries(
	deps: RegistriesRouteDeps,
	path: string,
	method: string,
	request: Request,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (path === "/api/registries" && method === "GET") {
		return listRegistriesHandler(deps.db, deps.registryManager);
	}

	if (path === "/api/registries" && method === "POST") {
		return createRegistryHandler(deps.db, deps.registryManager, request);
	}

	if (path === "/api/registries/preview" && method === "GET") {
		return previewRegistryHandler(deps.db, url);
	}

	const searchMatch = path.match(/^\/api\/registries\/([^/]+)\/search$/);
	if (searchMatch && method === "GET") {
		return searchRegistryHandler(
			deps.registryManager,
			decodeURIComponent(searchMatch[1]),
			url,
		);
	}

	// view uses a wildcard tail so item IDs containing slashes work
	const viewMatch = path.match(/^\/api\/registries\/([^/]+)\/view\/(.+)$/);
	if (viewMatch && method === "GET") {
		return viewRegistryHandler(
			deps.registryManager,
			decodeURIComponent(viewMatch[1]),
			decodeURIComponent(viewMatch[2]),
			url,
		);
	}

	const refreshMatch = path.match(/^\/api\/registries\/([^/]+)\/refresh$/);
	if (refreshMatch && method === "POST") {
		return refreshRegistryHandler(
			deps.db,
			deps.registryManager,
			decodeURIComponent(refreshMatch[1]),
		);
	}

	const itemMatch = path.match(/^\/api\/registries\/([^/]+)$/);
	if (itemMatch && method === "DELETE") {
		return deleteRegistryHandler(
			deps.db,
			deps.registryManager,
			decodeURIComponent(itemMatch[1]),
		);
	}
	if (itemMatch && method === "PATCH") {
		return patchRegistryHandler(
			deps.db,
			deps.registryManager,
			decodeURIComponent(itemMatch[1]),
			request,
		);
	}

	return null;
}
