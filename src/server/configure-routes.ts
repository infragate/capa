import type { CapaDatabase } from "../db/database";
import {
	normalizeCapabilities,
	parseCapabilitiesFile,
} from "../shared/capabilities";
import { logger } from "../shared/logger";
import { detectCapabilitiesFile } from "../shared/paths";
import { trustStdioServers } from "../shared/stdio-allowlist";
import { projectUiUrl } from "../shared/ui-urls";
import { mcpServerIdsPendingCredentials } from "../shared/secret-value";
import { extractAllVariables } from "../shared/variable-resolver";
import type { Capabilities } from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import type { CapabilitiesFileWatcher } from "./capabilities-watcher";
import { matchRoute } from "./match-route";
import type { CapaMCPServer, ValidationProgressEvent } from "./mcp-handler";
import {
	type McpServerStateManager,
	syncProjectServerEnablement,
} from "./mcp-server-state";
import { OAuth2Manager } from "./oauth-manager";
import {
	type OAuth2ServerEntry,
	serverHasExplicitAuthHeader,
	syncServerOAuth2Requirement,
} from "./oauth-server-sync";
import {
	type EffectiveCapsCacheEntry,
	loadEffectiveCapabilities,
} from "./resolve-effective-capabilities";
import type { SessionManager } from "./session-manager";
import { syncProjectManagedArtifactsAndWrapShadows } from "./sync-project-artifacts";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface ConfigureRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
	oauth2Manager: OAuth2Manager;
	capsWatcher: CapabilitiesFileWatcher;
	effectiveCapsCache: Map<string, EffectiveCapsCacheEntry>;
	getOrCreateMCPServer: (projectId: string) => CapaMCPServer | null;
	uiOrigin: () => string;
	/** Close stale MCP children after capabilities are updated (version bumps, etc.). */
	syncProjectMcpClients?: (
		projectId: string,
		servers: Capabilities["servers"],
		previousServers?: Capabilities["servers"],
	) => void | Promise<void>;
	mcpServerState?: McpServerStateManager;
	/** Notify live UI clients after server enablement changes. */
	notifyProjectChanged?: (projectId: string) => void;
}

async function applyProjectServerEnablement(
	deps: ConfigureRouteDeps,
	projectId: string,
	servers: Capabilities["servers"],
	previousServers: Capabilities["servers"] | undefined,
): Promise<void> {
	if (!deps.mcpServerState) return;
	syncProjectServerEnablement(
		deps.mcpServerState,
		projectId,
		servers,
		previousServers,
	);
	const mcpServer = deps.getOrCreateMCPServer(projectId);
	if (mcpServer) {
		await mcpServer.disconnectNonEnabledServers((serverId) =>
			deps.mcpServerState!.isEnabled(projectId, serverId),
		);
	}
	deps.notifyProjectChanged?.(projectId);
}

async function syncManagedArtifactsForProject(
	deps: ConfigureRouteDeps,
	projectId: string,
	capabilitiesToUse: Capabilities,
): Promise<void> {
	const apiLogger = logger.child("CapaServer").child("API");
	const project = deps.db.getProject(projectId);
	if (!project) return;

	const file = await detectCapabilitiesFile(project.path);
	if (!file) return;

	const artifacts = await syncProjectManagedArtifactsAndWrapShadows({
		projectPath: project.path,
		projectId,
		capabilitiesFilePath: file.path,
		capabilities: capabilitiesToUse,
		db: deps.db,
		serverOrigin: deps.uiOrigin(),
	});
	for (const w of [
		...artifacts.hooks.warnings,
		...artifacts.rules.warnings,
		...artifacts.agents.warnings,
		...artifacts.subagents.warnings,
	]) {
		apiLogger.warn(w);
	}
	if (artifacts.hooks.installed > 0 || artifacts.hooks.removed > 0) {
		apiLogger.info(
			`Hooks synced (installed=${artifacts.hooks.installed}, removed=${artifacts.hooks.removed})`,
		);
	}
	if (artifacts.rules.installed > 0 || artifacts.rules.removed > 0) {
		apiLogger.info(
			`Rules synced (installed=${artifacts.rules.installed}, removed=${artifacts.rules.removed})`,
		);
	}
	if (artifacts.agents.installed > 0 || artifacts.agents.removed > 0) {
		apiLogger.info(
			`Agent instructions synced (installed=${artifacts.agents.installed}, removed=${artifacts.agents.removed})`,
		);
	}
	if (artifacts.subagents.installed > 0 || artifacts.subagents.removed > 0) {
		apiLogger.info(
			`Sub-agents synced (installed=${artifacts.subagents.installed}, removed=${artifacts.subagents.removed})`,
		);
	}
}

/**
 * Reload in-memory capabilities after a file write without probing OAuth or
 * validating every MCP tool. Used for reorder (and similar) so large projects
 * do not block or drop the HTTP response while re-checking 6+ servers.
 */
export async function applyProjectCapabilitiesOnly(
	deps: ConfigureRouteDeps,
	projectId: string,
	capabilities: Capabilities,
): Promise<{ success: true }> {
	const apiLogger = logger.child("CapaServer").child("API");
	apiLogger.info(`Refresh capabilities (light) for project: ${projectId}`);

	const project = deps.db.getProject(projectId);
	let capabilitiesToUse = capabilities;

	if (project && (capabilities.plugins?.length ?? 0) > 0) {
		const file = await detectCapabilitiesFile(project.path);
		if (file) {
			deps.effectiveCapsCache.delete(projectId);
			capabilitiesToUse = await loadEffectiveCapabilities(
				capabilities,
				project.path,
				projectId,
				file.path,
				deps.db,
				deps.effectiveCapsCache,
			);
		}
	} else {
		deps.effectiveCapsCache.delete(projectId);
	}

	const previousCapabilities =
		deps.sessionManager.getProjectCapabilities(projectId);
	deps.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);
	if (project) {
		void deps.capsWatcher.watchProject(projectId, project.path);
	}

	// UI capability writes (add/remove servers) use this light path instead of
	// full configure — still auto-enable servers present in capabilities.
	await applyProjectServerEnablement(
		deps,
		projectId,
		capabilitiesToUse.servers,
		previousCapabilities?.servers,
	);

	if (project) {
		await syncManagedArtifactsForProject(deps, projectId, capabilitiesToUse);
	}

	apiLogger.success(
		`Capabilities refreshed (tools=${capabilitiesToUse.tools.length}, servers=${capabilitiesToUse.servers.length})`,
	);
	return { success: true };
}

/**
 * Configure a project: detect OAuth2 requirements per HTTP server, check
 * required variables, and validate that the configured tools actually
 * exist on their remote servers. Both the OAuth2 probe and the tool-list
 * lookup are fanned out across servers with `Promise.all`, so wall time
 * is dominated by the slowest server rather than the sum of all servers.
 *
 * The optional `onProgress` callback receives per-stage events that the
 * NDJSON streaming branch forwards to the install CLI for live UI
 * updates. Returns the same response body shape this endpoint has always
 * returned, so the JSON fallback path stays bit-for-bit compatible.
 */
export async function runProjectConfigure(
	deps: ConfigureRouteDeps,
	projectId: string,
	capabilities: Capabilities,
	onProgress?: (event: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
	const apiLogger = logger.child("CapaServer").child("API");
	apiLogger.info(`Configure project: ${projectId}`);

	const project = deps.db.getProject(projectId);
	let capabilitiesToUse = capabilities;

	if (project && (capabilities.plugins?.length ?? 0) > 0) {
		const file = await detectCapabilitiesFile(project.path);
		if (file) {
			deps.effectiveCapsCache.delete(projectId);
			capabilitiesToUse = await loadEffectiveCapabilities(
				capabilities,
				project.path,
				projectId,
				file.path,
				deps.db,
				deps.effectiveCapsCache,
			);
		}
	} else {
		deps.effectiveCapsCache.delete(projectId);
	}

	apiLogger.info(
		`Skills: ${capabilitiesToUse.skills.map((s) => s.id).join(", ")}`,
	);
	apiLogger.info(`Tools: ${capabilitiesToUse.tools.length}`);
	apiLogger.info(`Servers: ${capabilitiesToUse.servers.length}`);

	const previousCapabilities =
		deps.sessionManager.getProjectCapabilities(projectId);
	deps.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);

	if (deps.syncProjectMcpClients) {
		await deps.syncProjectMcpClients(
			projectId,
			capabilitiesToUse.servers,
			previousCapabilities?.servers,
		);
	}

	if (project) {
		void deps.capsWatcher.watchProject(projectId, project.path);
	}

	// -- OAuth2 detection (parallel) ------------------------------------
	const oauth2Candidates = capabilitiesToUse.servers.filter((server) => {
		if (!server.def.url) return false;
		if (serverHasExplicitAuthHeader(server)) {
			apiLogger.debug(
				`Skipping OAuth2 detection for ${server.id} (explicit auth header configured)`,
			);
			return false;
		}
		return true;
	});

	apiLogger.info(
		`Detecting OAuth2 requirements across ${oauth2Candidates.length} server(s)...`,
	);
	onProgress?.({
		type: "oauth2_init",
		totalServers: oauth2Candidates.length,
	});

	let oauth2Done = 0;
	let oauth2CapabilitiesChanged = false;
	const oauth2Results = await Promise.all(
		oauth2Candidates.map(async (server) => {
			let entry: OAuth2ServerEntry | null = null;
			try {
				apiLogger.debug(`Checking server: ${server.id}`);
				const sync = await syncServerOAuth2Requirement(
					projectId,
					server,
					deps.oauth2Manager,
				);
				if (sync.changed) oauth2CapabilitiesChanged = true;
				entry = sync.entry;
				if (entry) {
					apiLogger.debug(
						`OAuth2 required for ${server.id} (connected=${entry.isConnected})`,
					);
					if (!entry.isConnected) {
						apiLogger.warn(`OAuth2 token invalid/expired for ${server.id}`);
					}
				} else if (sync.changed) {
					apiLogger.debug(`OAuth2 no longer required for ${server.id}`);
				}
			} catch (error: any) {
				apiLogger.warn(
					`OAuth2 detection failed for ${server.id}: ${error.message ?? error}`,
				);
			} finally {
				oauth2Done++;
				onProgress?.({
					type: "oauth2_done",
					serverId: server.id,
					done: oauth2Done,
					total: oauth2Candidates.length,
					needsAuth: !!entry && !entry.isConnected,
				});
			}
			return entry;
		}),
	);
	const oauth2Servers = oauth2Results.filter(
		(e): e is OAuth2ServerEntry => e !== null,
	);

	if (oauth2CapabilitiesChanged || oauth2Servers.length > 0) {
		deps.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);
	}

	// -- Required variables ---------------------------------------------
	// Authored capabilities only — plugin-merged subagents/skills/etc. can
	// contain `${…}` as prose and must not become required credentials.
	const requiredVars = extractAllVariables(capabilities);
	apiLogger.info(`Required variables: ${requiredVars.join(", ")}`);

	const missingVars: string[] = [];
	for (const varName of requiredVars) {
		const value = deps.db.getVariable(projectId, varName);
		if (!value) {
			missingVars.push(varName);
		}
	}

	const needsOAuth2Connection = oauth2Servers.some((s) => !s.isConnected);

	// -- Tool validation (parallel per server) --------------------------
	apiLogger.info("Validating tools...");
	// Trust authored defs only — never resolve secrets into the allowlist fingerprint.
	trustStdioServers(projectId, capabilitiesToUse.servers ?? []);
	let toolValidationResults: any[] = [];
	try {
		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (mcpServer) {
			toolValidationResults = await mcpServer.validateTools(
				capabilitiesToUse,
				onProgress
					? (event: ValidationProgressEvent) =>
							onProgress(event as unknown as Record<string, unknown>)
					: undefined,
			);
		}

		const pendingServerIds = new Set(
			oauth2Servers.filter((s) => !s.isConnected).map((s) => s.serverId),
		);
		// Only servers that actually failed need excusing, and resolving a def
		// can re-run a `fromCommand` secret — so don't touch the ones that
		// validated fine.
		const failedServerIds = new Set(
			toolValidationResults
				.filter((r) => !r.success && r.serverId)
				.map((r) => r.serverId),
		);
		const pendingCandidates = (capabilitiesToUse.servers ?? []).filter(
			(s) => failedServerIds.has(s.id) && !pendingServerIds.has(s.id),
		);
		if (project && pendingCandidates.length > 0) {
			for (const id of await mcpServerIdsPendingCredentials(pendingCandidates, {
				projectId,
				projectPath: project.path,
				db: deps.db,
			})) {
				pendingServerIds.add(id);
			}
		}
		const nonPendingValidationResults = toolValidationResults.filter(
			(r) => !pendingServerIds.has(r.serverId),
		);
		const pendingResults = toolValidationResults.filter((r) =>
			pendingServerIds.has(r.serverId),
		);

		if (pendingResults.length > 0) {
			apiLogger.info(
				`${pendingResults.length} tool(s) skipped validation (credentials pending)`,
			);
			for (const pending of pendingResults) {
				pending.success = true;
				pending.pendingAuth = true;
				pending.error = undefined;
			}
		}

		const failedTools = nonPendingValidationResults.filter((r) => !r.success);
		if (failedTools.length > 0) {
			apiLogger.warn(`${failedTools.length} tool(s) failed validation`);
			for (const failed of failedTools) {
				apiLogger.debug(`  ${failed.toolId}: ${failed.error}`);
			}
		} else if (nonPendingValidationResults.length > 0) {
			apiLogger.success(
				`All ${nonPendingValidationResults.length} non-pending tool(s) validated successfully`,
			);
		}
	} catch (error: any) {
		apiLogger.failure(`Tool validation error: ${error.message}`);
	}

	// Install / UI / wrap configure: enable every server in capabilities and
	// drop connections for servers removed from the project.
	await applyProjectServerEnablement(
		deps,
		projectId,
		capabilitiesToUse.servers,
		previousCapabilities?.servers,
	);

	if (project) {
		await syncManagedArtifactsForProject(deps, projectId, capabilitiesToUse);
	}

	if (missingVars.length > 0 || needsOAuth2Connection) {
		apiLogger.warn(`Missing variables: ${missingVars.join(", ")}`);
		if (needsOAuth2Connection) {
			apiLogger.warn(
				`OAuth2 connections needed: ${oauth2Servers
					.filter((s) => !s.isConnected)
					.map((s) => s.serverId)
					.join(", ")}`,
			);
		}
		const credentialsUrl = projectUiUrl(deps.uiOrigin(), projectId);
		return {
			success: false,
			needsCredentials: true,
			missingVariables: missingVars,
			oauth2Servers,
			credentialsUrl,
			toolValidation: toolValidationResults,
		};
	}

	apiLogger.success("Project configured successfully");
	return {
		success: true,
		needsCredentials: false,
		toolValidation: toolValidationResults,
	};
}

async function capabilitiesForConfigure(
	deps: ConfigureRouteDeps,
	projectId: string,
	requested: Capabilities,
): Promise<Capabilities> {
	const project = deps.db.getProject(projectId);
	if (!project) {
		throw new Error("Project not found");
	}
	const file = await detectCapabilitiesFile(project.path);
	if (!file) {
		throw new Error("No capabilities file on disk for this project");
	}
	const onDisk = await parseCapabilitiesFile(file.path, file.format);
	// Wrap-install compatibility: overlay providers only. Stdio spawn config
	// (cmd/args/cwd/env) always comes from the on-disk document.
	// Ignore empty provider arrays — wrapping with no identity providers used
	// to send `providers: []`, which blocked plugin MCP expansion.
	if (requested.providers && requested.providers.length > 0) {
		onDisk.providers = requested.providers;
	}
	return onDisk;
}

export async function handleProjectConfigure(
	deps: ConfigureRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	const apiLogger = logger.child("CapaServer").child("API");
	const wantsStream = (request.headers.get("accept") ?? "")
		.toLowerCase()
		.includes("application/x-ndjson");

	let requested: unknown;
	try {
		requested = await request.json();
	} catch (error: any) {
		apiLogger.failure(`Error parsing capabilities: ${error.message}`);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}

	let capabilities: Capabilities;
	try {
		const parsed = normalizeCapabilities(requested);
		capabilities = await capabilitiesForConfigure(deps, projectId, parsed);
	} catch (error: any) {
		apiLogger.failure(`Error: ${error.message}`);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}

	if (!wantsStream) {
		try {
			const body = await runProjectConfigure(deps, projectId, capabilities);
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: JSON_HEADERS,
			});
		} catch (error: any) {
			apiLogger.failure(`Error: ${error.message}`);
			return new Response(JSON.stringify({ error: error.message }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}
	}

	const encoder = new TextEncoder();
	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
	let streamClosed = false;
	let pending: string[] = [];

	const writeLine = (line: string): void => {
		if (streamClosed) return;
		if (!controllerRef) {
			pending.push(line);
			return;
		}
		try {
			controllerRef.enqueue(encoder.encode(line));
		} catch {
			streamClosed = true;
		}
	};

	const emit = (event: Record<string, unknown>) => {
		writeLine(`${JSON.stringify(event)}\n`);
	};

	const work = runProjectConfigure(deps, projectId, capabilities, emit).then(
		(body) => ({ ok: true as const, body }),
		(error: any) => ({ ok: false as const, error }),
	);

	const stream = new ReadableStream<Uint8Array>({
		start: (controller) => {
			controllerRef = controller;
			const buffered = pending;
			pending = [];
			for (const line of buffered) writeLine(line);
			work.then((outcome) => {
				if (outcome.ok) {
					writeLine(`${JSON.stringify({ type: "result", ...outcome.body })}\n`);
				} else {
					apiLogger.failure(
						`Error: ${outcome.error?.message ?? outcome.error}`,
					);
					writeLine(
						`${JSON.stringify({ type: "error", error: outcome.error?.message ?? String(outcome.error) })}\n`,
					);
				}
				if (!streamClosed) {
					try {
						controller.close();
					} catch {
						// Already closed
					}
					streamClosed = true;
				}
			});
		},
		cancel: () => {
			streamClosed = true;
			controllerRef = null;
			pending = [];
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "no-cache",
		},
	});
}

/**
 * Dispatcher for `/api/projects/:id/configure`.
 * Returns null if the path is not the configure route.
 */
export async function dispatchConfigure(
	deps: ConfigureRouteDeps,
	path: string,
	method: string,
	request: Request,
): Promise<Response | null> {
	const config = matchRoute(path, "/api/projects/:projectId/configure");
	if (config && method === "POST") {
		return handleProjectConfigure(deps, config.projectId, request);
	}
	return null;
}
