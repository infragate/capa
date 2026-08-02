import { rmSync, statSync } from "fs";
import { getRepoSnapshot } from "../cli/commands/install-tasks/helpers/repo-snapshot";
import { resolvePlugins } from "../cli/commands/plugin-install";
import type { CapaDatabase } from "../db/database";
import { createAuthenticatedFetch } from "../shared/authenticated-fetch";
import { LockfileBuilder, loadLockfile } from "../shared/lockfile";
import { logger } from "../shared/logger";
import { validateProvider } from "../shared/providers/resolve";
import type { Capabilities } from "../types/capabilities";

const log = logger.child("plugin-resolve");

export interface EffectiveCapsCacheEntry {
	/** capabilities file mtimeMs used as a cheap invalidation key */
	mtimeMs: number;
	/** Stable fingerprint of plugin entries (ids + repos) */
	pluginsKey: string;
	caps: Capabilities;
}

function pluginsCacheKey(
	plugins: NonNullable<Capabilities["plugins"]>,
): string {
	return plugins
		.map(
			(p) =>
				`${p.id ?? ""}|${p.type}|${p.def?.repo ?? ""}|${p.def?.version ?? ""}|${p.def?.ref ?? ""}`,
		)
		.join("||");
}

/**
 * Resolve providers for server-side plugin expansion without interactive prompts.
 * Returns null when none are configured (caller should skip resolvePlugins).
 */
export function resolveProvidersForServer(
	capabilities: Capabilities,
	db: CapaDatabase,
	projectId: string,
): string[] | null {
	if (capabilities.providers && capabilities.providers.length > 0) {
		return capabilities.providers.map((p) => validateProvider(p));
	}
	const stored = db.getProjectProviders(projectId);
	if (stored.length > 0) {
		return stored;
	}
	return null;
}

/**
 * Expand `plugins` into merged skills/servers/rules/hooks/subagents (in memory).
 * Unpacks plugin trees under `~/.capa/plugins/<projectId>/` but does **not**
 * copy skills into the project's `.claude/` / `.cursor/` dirs — that only
 * happens during `capa install` / wrap shadow-workspace install.
 * Returns the authored capabilities unchanged when there are no plugins or providers.
 */
export async function resolveEffectiveCapabilities(
	authored: Capabilities,
	projectPath: string,
	projectId: string,
	capabilitiesFilePath: string,
	db: CapaDatabase,
): Promise<{ caps: Capabilities; warnings: string[] }> {
	const plugins = authored.plugins ?? [];
	if (plugins.length === 0) {
		return { caps: authored, warnings: [] };
	}

	const providers = resolveProvidersForServer(authored, db, projectId);
	if (!providers) {
		const warning =
			"Plugins are declared but no providers are configured; plugin MCP servers were not expanded. " +
			"Add a providers section or run capa install --provider <id>.";
		log.warn(warning);
		return { caps: authored, warnings: [warning] };
	}

	const capsForResolve: Capabilities = { ...authored, providers };
	const existingLockfile = await loadLockfile(projectPath);
	const lockBuilder = new LockfileBuilder(existingLockfile);
	const authFetch = createAuthenticatedFetch(db);

	try {
		const { mergedCapabilities, tempDirsToCleanup, warnings } =
			await resolvePlugins(
				capsForResolve,
				projectPath,
				projectId,
				authFetch,
				db,
				(platform, repoPath, auth, opts) =>
					getRepoSnapshot(platform, repoPath, auth, opts),
				capabilitiesFilePath,
				lockBuilder,
				{
					// In-memory expand only — never write `.claude/` / `.cursor/`
					// into the real project from configure / API / wrap side-effects.
					materializeProjectSkills: false,
					trackManaged: false,
				},
			);
		for (const dir of tempDirsToCleanup) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
		mergedCapabilities.providers = providers;
		return { caps: mergedCapabilities, warnings };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error(`Plugin resolution failed for ${projectId}: ${message}`);
		return {
			caps: authored,
			warnings: [`Plugin resolution failed: ${message}`],
		};
	}
}

export function capabilitiesFileMtimeMs(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * Load authored capabilities from disk and expand plugins when needed.
 * Uses `cache` to skip re-resolution when the file mtime is unchanged.
 */
export async function loadEffectiveCapabilities(
	authored: Capabilities,
	projectPath: string,
	projectId: string,
	capabilitiesFilePath: string,
	db: CapaDatabase,
	cache?: Map<string, EffectiveCapsCacheEntry>,
): Promise<Capabilities> {
	const plugins = authored.plugins ?? [];
	if (plugins.length === 0) {
		cache?.delete(projectId);
		return authored;
	}

	const mtimeMs = capabilitiesFileMtimeMs(capabilitiesFilePath);
	const pluginsKey = pluginsCacheKey(plugins);
	const cached = cache?.get(projectId);
	if (
		cached &&
		cached.mtimeMs === mtimeMs &&
		cached.pluginsKey === pluginsKey
	) {
		return cached.caps;
	}

	const { caps, warnings } = await resolveEffectiveCapabilities(
		authored,
		projectPath,
		projectId,
		capabilitiesFilePath,
		db,
	);
	for (const w of warnings) {
		log.warn(w);
	}

	cache?.set(projectId, {
		mtimeMs,
		pluginsKey,
		caps,
	});
	return caps;
}

/**
 * When plugin expansion rebuilds servers from disk, discovered OAuth endpoints
 * (authorizationEndpoint / tokenEndpoint) would be lost. Copy them from the
 * previous in-memory session onto matching server ids.
 */
export function preserveDiscoveredOAuth2(
	fresh: Capabilities,
	previous: Capabilities | null | undefined,
): Capabilities {
	if (!previous?.servers?.length || !fresh.servers?.length) return fresh;

	const prevById = new Map(previous.servers.map((s) => [s.id, s]));
	for (const server of fresh.servers) {
		const prev = prevById.get(server.id);
		const prevOAuth = prev?.def?.oauth2;
		if (!prevOAuth) continue;

		const prevAuth =
			prevOAuth.authorizationEndpoint ||
			(prevOAuth as { authorizationUrl?: string }).authorizationUrl;
		const prevToken =
			prevOAuth.tokenEndpoint || (prevOAuth as { tokenUrl?: string }).tokenUrl;
		if (
			!prevAuth &&
			!prevToken &&
			!prevOAuth.resourceServer &&
			!prevOAuth.registrationEndpoint
		) {
			continue;
		}

		const nextOAuth = { ...(server.def.oauth2 ?? {}) } as Record<
			string,
			unknown
		>;
		const nextAuth =
			nextOAuth.authorizationEndpoint || nextOAuth.authorizationUrl;
		const nextToken = nextOAuth.tokenEndpoint || nextOAuth.tokenUrl;

		if (!nextAuth && prevAuth) {
			nextOAuth.authorizationEndpoint = prevAuth;
		}
		if (!nextToken && prevToken) {
			nextOAuth.tokenEndpoint = prevToken;
		}
		if (!nextOAuth.resourceServer && prevOAuth.resourceServer) {
			nextOAuth.resourceServer = prevOAuth.resourceServer;
		}
		if (!nextOAuth.registrationEndpoint && prevOAuth.registrationEndpoint) {
			nextOAuth.registrationEndpoint = prevOAuth.registrationEndpoint;
		}
		if (!nextOAuth.scope && prevOAuth.scope) {
			nextOAuth.scope = prevOAuth.scope;
		}

		server.def.oauth2 = nextOAuth as typeof server.def.oauth2;
	}

	return fresh;
}
