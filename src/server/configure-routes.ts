import type { CapaDatabase } from "../db/database";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { logger } from "../shared/logger";
import { detectCapabilitiesFile } from "../shared/paths";
import { projectUiUrl } from "../shared/ui-urls";
import { extractAllVariables } from "../shared/variable-resolver";
import type { Capabilities } from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import type { CapabilitiesFileWatcher } from "./capabilities-watcher";
import type { CapaMCPServer, ValidationProgressEvent } from "./mcp-handler";
import { OAuth2Manager } from "./oauth-manager";
import {
	type EffectiveCapsCacheEntry,
	loadEffectiveCapabilities,
} from "./resolve-effective-capabilities";
import type { SessionManager } from "./session-manager";

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

	deps.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);
	if (project) {
		void deps.capsWatcher.watchProject(projectId, project.path);
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
		const hasExplicitAuth =
			server.def.headers &&
			Object.keys(server.def.headers).some(
				(k) => k.toLowerCase() === "authorization",
			);
		if (hasExplicitAuth) {
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
	const oauth2Results = await Promise.all(
		oauth2Candidates.map(async (server) => {
			const existingOAuth = server.def.oauth2;
			let entry: {
				serverId: string;
				serverUrl: string;
				displayName: string;
				isConnected: boolean;
			} | null = null;
			try {
				apiLogger.debug(`Checking server: ${server.id}`);
				const oauth2Config = await deps.oauth2Manager.detectOAuth2Requirement(
					server.def.url!,
					{
						tlsSkipVerify: server.def.tlsSkipVerify,
					},
				);
				if (oauth2Config) {
					apiLogger.debug(`OAuth2 required for ${server.id}`);
					let isConnected = deps.oauth2Manager.isServerConnected(
						projectId,
						server.id,
					);

					if (isConnected) {
						const accessToken = await deps.oauth2Manager.getAccessToken(
							projectId,
							server.id,
							oauth2Config,
						);
						isConnected = !!accessToken;
						if (!isConnected) {
							apiLogger.warn(`OAuth2 token invalid/expired for ${server.id}`);
						}
					}

					const merged: any = { ...(existingOAuth ?? {}), ...oauth2Config };
					const embeddedClientId =
						(existingOAuth as any)?.client_id ??
						(existingOAuth as any)?.clientId ??
						(existingOAuth as any)?.CLIENT_ID ??
						(existingOAuth as any)?.oauth?.clientId ??
						(existingOAuth as any)?.oauth?.client_id;
					if (embeddedClientId) merged.client_id = embeddedClientId;
					const embeddedCallbackPort =
						(existingOAuth as any)?.callback_port ??
						(existingOAuth as any)?.callbackPort ??
						(existingOAuth as any)?.CALLBACK_PORT;
					if (
						typeof embeddedCallbackPort === "number" &&
						embeddedCallbackPort > 0
					) {
						merged.callback_port = embeddedCallbackPort;
					} else if (typeof embeddedCallbackPort === "string") {
						const parsed = Number(embeddedCallbackPort);
						if (Number.isFinite(parsed) && parsed > 0)
							merged.callback_port = parsed;
					}
					apiLogger.debug(
						`OAuth2 merged for ${server.id}: client_id=${merged.client_id ? "set" : "missing"} callback_port=${merged.callback_port ?? "missing"} registrationEndpoint=${merged.registrationEndpoint ? "set" : "missing"}`,
					);
					server.def.oauth2 = merged;
					entry = {
						serverId: server.id,
						serverUrl: server.def.url!,
						displayName: server.displayName ?? server.id,
						isConnected,
					};
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
		(e): e is NonNullable<typeof e> => e !== null,
	);

	if (oauth2Servers.length > 0) {
		deps.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);
	}

	// -- Required variables ---------------------------------------------
	const requiredVars = extractAllVariables(capabilitiesToUse);
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

		const oauth2ServerIds = new Set(
			oauth2Servers.filter((s) => !s.isConnected).map((s) => s.serverId),
		);
		const nonOAuth2ValidationResults = toolValidationResults.filter(
			(r) => !oauth2ServerIds.has(r.serverId),
		);
		const oauth2PendingResults = toolValidationResults.filter((r) =>
			oauth2ServerIds.has(r.serverId),
		);

		if (oauth2PendingResults.length > 0) {
			apiLogger.info(
				`${oauth2PendingResults.length} tool(s) skipped validation (OAuth2 authentication required)`,
			);
			for (const pending of oauth2PendingResults) {
				pending.success = true;
				pending.pendingAuth = true;
				pending.error = undefined;
			}
		}

		const failedTools = nonOAuth2ValidationResults.filter((r) => !r.success);
		if (failedTools.length > 0) {
			apiLogger.warn(`${failedTools.length} tool(s) failed validation`);
			for (const failed of failedTools) {
				apiLogger.debug(`  ${failed.toolId}: ${failed.error}`);
			}
		} else if (nonOAuth2ValidationResults.length > 0) {
			apiLogger.success(
				`All ${nonOAuth2ValidationResults.length} non-OAuth2 tool(s) validated successfully`,
			);
		}
	} catch (error: any) {
		apiLogger.failure(`Tool validation error: ${error.message}`);
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

export async function handleProjectConfigure(
	deps: ConfigureRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	const apiLogger = logger.child("CapaServer").child("API");
	const wantsStream = (request.headers.get("accept") ?? "")
		.toLowerCase()
		.includes("application/x-ndjson");

	let capabilities: Capabilities;
	try {
		capabilities = await request.json();
	} catch (error: any) {
		apiLogger.failure(`Error parsing capabilities: ${error.message}`);
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
