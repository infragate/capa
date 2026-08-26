import { createServer, type Server as HttpServer } from "http";
import type { CapaDatabase } from "../db/database";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { logger } from "../shared/logger";
import { detectCapabilitiesFile } from "../shared/paths";
import { projectUiUrl } from "../shared/ui-urls";
import type { MCPServer } from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import { matchRoute } from "./match-route";
import { OAuth2DetectionStatus, type OAuth2Manager } from "./oauth-manager";
import { syncAllServersOAuth2Requirements } from "./oauth-server-sync";
import {
	type EffectiveCapsCacheEntry,
	enrichCapabilitiesOAuthFromPlugins,
} from "./resolve-effective-capabilities";
import { redactOAuth2ConfigForApi } from "./secret-redaction";
import type { SessionManager } from "./session-manager";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface OAuthRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
	oauth2Manager: OAuth2Manager;
	serverHost: string;
	serverPort: number;
	uiOrigin: () => string;
	effectiveCapsCache: Map<string, EffectiveCapsCacheEntry>;
}

/** Claude-style OAuth callback servers: port -> { server, idleTimer }; closed after completion or 5 min idle */
const oauthCallbackServers = new Map<
	number,
	{ server: HttpServer; idleTimer: ReturnType<typeof setTimeout> }
>();

const routeLogger = logger.child("CapaServer");

function apiLog() {
	return routeLogger.child("API");
}

/** Close and remove the callback server for a port (after completion or idle timeout). */
function closeOAuthCallbackServer(port: number): void {
	const entry = oauthCallbackServers.get(port);
	if (!entry) return;
	clearTimeout(entry.idleTimer);
	entry.server.close();
	oauthCallbackServers.delete(port);
	routeLogger.debug(`OAuth callback server on port ${port} closed`);
}

/** Close all Claude-style OAuth callback servers (server shutdown). */
export function closeAllOAuthCallbackServers(): void {
	for (const [port, entry] of oauthCallbackServers) {
		clearTimeout(entry.idleTimer);
		entry.server.close();
		routeLogger.debug(`Closed OAuth callback server on port ${port}`);
	}
	oauthCallbackServers.clear();
}

/**
 * Ensure a Claude-style OAuth callback server is listening on the given port.
 * Serves GET /callback?code=...&state=... and redirects to main UI after token exchange.
 * Closed after completion or after 5 minutes idle. Used when a plugin provides clientId + callbackPort in .mcp.json (e.g. Slack).
 * Binds directly and retries on EADDRINUSE (no separate port-availability check).
 */
async function ensureOAuthCallbackServer(
	deps: OAuthRouteDeps,
	startPort: number,
	maxAttempts = 10,
): Promise<number> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const port = startPort + attempt;
		if (oauthCallbackServers.has(port)) {
			return port;
		}
		try {
			await bindOAuthCallbackServer(deps, port);
			return port;
		} catch (err: any) {
			if (err?.code === "EADDRINUSE") {
				routeLogger.warn(
					`OAuth callback port ${port} in use, trying ${port + 1}`,
				);
				continue;
			}
			throw err;
		}
	}
	throw new Error(
		`Could not bind OAuth callback server after ${maxAttempts} attempts starting at ${startPort}`,
	);
}

function bindOAuthCallbackServer(
	deps: OAuthRouteDeps,
	port: number,
): Promise<void> {
	const IDLE_MS = 5 * 60 * 1000; // 5 minutes
	const mainBase = deps.uiOrigin();

	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			if (req.method !== "GET" || !req.url) {
				res.writeHead(405);
				res.end();
				return;
			}
			const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
			if (reqUrl.pathname !== "/callback") {
				res.writeHead(404);
				res.end();
				return;
			}
			const entry = oauthCallbackServers.get(port);
			if (entry) clearTimeout(entry.idleTimer);
			const closeWhenDone = () => {
				res.on("finish", () => closeOAuthCallbackServer(port));
			};

			const code = reqUrl.searchParams.get("code");
			const state = reqUrl.searchParams.get("state");
			const error = reqUrl.searchParams.get("error");
			const apiLogger = apiLog();

			const redirectToUi = (
				projectId: string | undefined,
				success: boolean,
				message?: string,
				serverId?: string,
			) => {
				closeWhenDone();
				const loc = projectId
					? projectUiUrl(mainBase, projectId, {
							...(success
								? { oauth_success: message ?? "true" }
								: { oauth_error: message ?? "Unknown error" }),
							...(serverId ? { server: serverId } : {}),
						})
					: `${mainBase}/`;
				res.writeHead(302, { Location: loc });
				res.end();
			};

			if (error) {
				apiLogger.error(`OAuth2 callback error: ${error}`);
				let projectId: string | undefined;
				if (state) {
					const flow = deps.db.getFlowState(state);
					projectId = flow?.project_id;
				}
				redirectToUi(projectId, false, error);
				return;
			}

			if (!code || !state) {
				redirectToUi(undefined, false, "Missing code or state");
				return;
			}

			apiLogger.info("OAuth2 callback (Claude-style) received");
			deps.oauth2Manager
				.handleCallback(code, state)
				.then((result) => {
					if (!result.success) {
						apiLogger.failure(`Callback failed: ${result.error}`);
						redirectToUi(
							result.projectId,
							false,
							result.error ?? "Token exchange failed",
						);
						return;
					}
					apiLogger.success(
						`OAuth2 flow completed for server: ${result.serverId}`,
					);
					redirectToUi(result.projectId, true, "true", result.serverId);
				})
				.catch((err: any) => {
					apiLogger.failure(`Callback error: ${err.message}`);
					redirectToUi(
						undefined,
						false,
						err.message ?? "Token exchange failed",
					);
				});
		});

		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			routeLogger.info(
				`OAuth callback server (Claude-style) listening on http://localhost:${port}/callback`,
			);
			const idleTimer = setTimeout(() => {
				routeLogger.debug(
					`OAuth callback server on port ${port} idle for 5 min, closing`,
				);
				closeOAuthCallbackServer(port);
			}, IDLE_MS);
			oauthCallbackServers.set(port, { server, idleTimer });
			server.on("error", (err: any) => {
				routeLogger.failure(
					`OAuth callback server on port ${port}: ${err.message}`,
				);
				closeOAuthCallbackServer(port);
			});
			resolve();
		});
	});
}

export async function handleGetOAuth2Servers(
	deps: OAuthRouteDeps,
	projectId: string,
): Promise<Response> {
	const apiLogger = apiLog();
	apiLogger.info(`Get OAuth2 servers for project: ${projectId}`);
	try {
		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const project = deps.db.getProject(projectId);
		if (project) {
			try {
				const file = await detectCapabilitiesFile(project.path);
				if (file) {
					const authored = await parseCapabilitiesFile(file.path, file.format);
					await enrichCapabilitiesOAuthFromPlugins(
						capabilities,
						authored,
						project.path,
						projectId,
						file.path,
						deps.db,
						deps.effectiveCapsCache,
					);
				}
			} catch (error: unknown) {
				apiLogger.warn(
					`OAuth plugin enrichment skipped for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		const oauthSync = await syncAllServersOAuth2Requirements(
			projectId,
			capabilities,
			deps.oauth2Manager,
		);
		if (oauthSync.changed) {
			deps.sessionManager.setProjectCapabilities(projectId, capabilities);
			for (const entry of oauthSync.entries) {
				apiLogger.debug(
					`OAuth2 required for ${entry.serverId} (connected=${entry.isConnected})`,
				);
			}
		}

		const oauth2Servers = capabilities.servers
			.filter((s) => s.def.oauth2)
			.map((s: MCPServer) => {
				const isConnected = deps.oauth2Manager.isServerConnected(
					projectId,
					s.id,
				);
				let expiresAt: number | undefined;

				if (isConnected) {
					const tokenData = deps.db.getOAuthToken(projectId, s.id);
					expiresAt = tokenData?.expires_at ?? undefined;
				}

				return {
					serverId: s.id,
					serverUrl: s.def.url,
					displayName: s.displayName ?? s.id,
					isConnected: isConnected,
					expiresAt: expiresAt,
					oauth2Config: redactOAuth2ConfigForApi(
						s.def.oauth2 as Record<string, unknown>,
					),
				};
			});

		return new Response(JSON.stringify({ servers: oauth2Servers }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		apiLogger.failure(
			`Error getting OAuth2 servers: ${error?.message ?? error}`,
		);
		return new Response(
			JSON.stringify({ error: "Failed to load OAuth2 servers" }),
			{ status: 500, headers: JSON_HEADERS },
		);
	}
}

export async function handleOAuth2Start(
	deps: OAuthRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	const apiLogger = apiLog();
	try {
		const url = new URL(request.url);
		const serverId = url.searchParams.get("server");

		if (!serverId) {
			return new Response(
				JSON.stringify({ error: "Missing server parameter" }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		apiLogger.info(`Start OAuth2 flow for server: ${serverId}`);

		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const server = capabilities.servers.find((s: any) => s.id === serverId);
		if (!server || !server.def.oauth2) {
			return new Response(
				JSON.stringify({
					error: "Server not found or does not require OAuth2",
				}),
				{ status: 404, headers: JSON_HEADERS },
			);
		}

		const oauth2 = server.def.oauth2;
		const effectiveClientId = oauth2.clientId;
		const effectiveCallbackPort =
			typeof oauth2.callbackPort === "number" && oauth2.callbackPort > 0
				? oauth2.callbackPort
				: undefined;
		// Claude-style only when dynamic client registration is not supported and the
		// plugin provides clientId + callbackPort (e.g. Slack). Auth servers register
		// specific (client_id, redirect_uri) pairs; falling back to the capa-server URL
		// when the plugin embedded a callbackPort causes the auth server to reject.
		const useClaudeCallback =
			!!effectiveClientId &&
			effectiveCallbackPort != null &&
			!oauth2.registrationEndpoint;
		let callbackPort = effectiveCallbackPort;
		if (useClaudeCallback && callbackPort != null) {
			callbackPort = await ensureOAuthCallbackServer(deps, callbackPort);
		}
		const redirectUri = useClaudeCallback
			? `http://localhost:${callbackPort}/callback`
			: `http://${deps.serverHost}:${deps.serverPort}/api/projects/${projectId}/oauth/callback`;
		apiLogger.debug(
			`OAuth2 redirect for ${serverId}: ${redirectUri} (useClaudeCallback=${useClaudeCallback}, clientId=${effectiveClientId ? "set" : "missing"}, callbackPort=${effectiveCallbackPort ?? "missing"}, registrationEndpoint=${oauth2.registrationEndpoint ? "set" : "missing"})`,
		);

		// Plugin manifests (e.g. Slack) often only embed clientId + callbackPort;
		// discovery fills authorization/token endpoints during configure — but GET
		// can re-expand plugins and drop those. Discover on demand if still missing.
		let configForFlow = {
			...oauth2,
			...(effectiveClientId ? { clientId: effectiveClientId } : {}),
		} as OAuth2Config;
		if (server.def.url) {
			apiLogger.info(`Refreshing OAuth metadata for ${serverId}…`);
			const detected = await deps.oauth2Manager.detectOAuth2Requirement(
				server.def.url,
				{
					tlsSkipVerify: server.def.tlsSkipVerify,
				},
			);
			if (detected.status === OAuth2DetectionStatus.NOT_REQUIRED) {
				// Clear stale oauth2 config only — never delete tokens from a probe.
				delete server.def.oauth2;
				deps.sessionManager.setProjectCapabilities(projectId, capabilities);
				return new Response(
					JSON.stringify({
						error:
							"This server no longer requires OAuth. Refresh the page and try connecting to the server directly.",
					}),
					{ status: 409, headers: JSON_HEADERS },
				);
			}
			if (detected.status === OAuth2DetectionStatus.REQUIRED) {
				configForFlow = {
					...configForFlow,
					...detected.config,
					authorizationEndpoint:
						configForFlow.authorizationEndpoint ||
						detected.config.authorizationEndpoint,
					tokenEndpoint:
						configForFlow.tokenEndpoint || detected.config.tokenEndpoint,
					resourceServer:
						configForFlow.resourceServer ||
						detected.config.resourceServer ||
						server.def.url,
					scope: detected.config.scope ?? configForFlow.scope,
					...(effectiveClientId ? { clientId: effectiveClientId } : {}),
				};
				server.def.oauth2 = configForFlow;
				deps.sessionManager.setProjectCapabilities(projectId, capabilities);
			} else if (detected.status === OAuth2DetectionStatus.INCONCLUSIVE) {
				// Ambiguous probe or unsupported grant/response type: keep oauth2.
				// Do not start a flow we cannot complete when metadata is present
				// but authorization_code/code is missing.
				const reason = detected.reason;
				if (
					reason.includes("authorization_code") ||
					reason.includes("response_type=code")
				) {
					return new Response(
						JSON.stringify({
							error: `This server requires OAuth, but its authorization server does not support the authorization-code flow. ${reason}`,
						}),
						{ status: 409, headers: JSON_HEADERS },
					);
				}
				// Other inconclusive outcomes: keep existing endpoints and continue.
			}
		}

		const { url: authUrl, state } =
			await deps.oauth2Manager.generateAuthorizationUrl(
				projectId,
				serverId,
				configForFlow,
				redirectUri,
			);

		apiLogger.success("Authorization URL generated");
		return new Response(JSON.stringify({ authorizationUrl: authUrl, state }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		apiLogger.failure(`Error: ${error.message}`);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleOAuth2Callback(
	deps: OAuthRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	const apiLogger = apiLog();
	try {
		const url = new URL(request.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const error = url.searchParams.get("error");

		if (error) {
			apiLogger.error(`OAuth2 callback error: ${error}`);
			const redirectUrl = projectUiUrl(deps.uiOrigin(), projectId, {
				oauth_error: error,
			});
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		}

		if (!code || !state) {
			return new Response(
				JSON.stringify({ error: "Missing code or state parameter" }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		apiLogger.info(`OAuth2 callback for project: ${projectId}`);

		const result = await deps.oauth2Manager.handleCallback(code, state);

		if (!result.success) {
			apiLogger.failure(`Callback failed: ${result.error}`);
			const redirectUrl = projectUiUrl(deps.uiOrigin(), projectId, {
				oauth_error: result.error || "Unknown error",
			});
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		}

		apiLogger.success(`OAuth2 flow completed for server: ${result.serverId}`);

		const redirectUrl = projectUiUrl(deps.uiOrigin(), projectId, {
			oauth_success: "true",
			...(result.serverId ? { server: result.serverId } : {}),
		});
		return new Response(null, {
			status: 302,
			headers: { Location: redirectUrl },
		});
	} catch (error: any) {
		const apiLogger = apiLog();
		apiLogger.failure(`Error: ${error.message}`);
		const redirectUrl = projectUiUrl(deps.uiOrigin(), projectId, {
			oauth_error: error.message,
		});
		return new Response(null, {
			status: 302,
			headers: { Location: redirectUrl },
		});
	}
}

export async function handleOAuth2Disconnect(
	deps: OAuthRouteDeps,
	projectId: string,
	serverId: string,
): Promise<Response> {
	const apiLogger = apiLog();
	apiLogger.info(`Disconnect OAuth2 for server: ${serverId}`);
	try {
		deps.oauth2Manager.disconnect(projectId, serverId);
		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		apiLogger.failure(`Error: ${error.message}`);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

/**
 * Dispatcher for project OAuth2 API routes.
 * Returns null if the path is not an OAuth2 route.
 */
export async function dispatchOAuth(
	deps: OAuthRouteDeps,
	path: string,
	method: string,
	request: Request,
): Promise<Response | null> {
	const servers = matchRoute(path, "/api/projects/:projectId/oauth-servers");
	if (servers && method === "GET") {
		return handleGetOAuth2Servers(deps, servers.projectId);
	}

	const start = matchRoute(path, "/api/projects/:projectId/oauth/start");
	if (start && method === "POST") {
		return handleOAuth2Start(deps, start.projectId, request);
	}

	const callback = matchRoute(path, "/api/projects/:projectId/oauth/callback");
	if (callback && method === "GET") {
		return handleOAuth2Callback(deps, callback.projectId, request);
	}

	const disconnect = matchRoute(
		path,
		"/api/projects/:projectId/oauth/:serverId",
	);
	if (disconnect && method === "DELETE") {
		return handleOAuth2Disconnect(
			deps,
			disconnect.projectId,
			disconnect.serverId,
		);
	}

	return null;
}
