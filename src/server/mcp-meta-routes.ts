import type { CapaDatabase } from "../db/database";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { detectCapabilitiesFile } from "../shared/paths";
import { trustStdioServers } from "../shared/stdio-allowlist";
import { resolveVariablesInObject } from "../shared/variable-resolver";
import type { Capabilities, MCPServer, MCPServerDefinition } from "../types/capabilities";
import type { CapaMCPServer, ShellToolInfo } from "./mcp-handler";
import type { McpServerStateManager } from "./mcp-server-state";
import type { SessionManager } from "./session-manager";
import { resolveSkillContentById } from "./skill-content";
import { clientErrorMessage } from "./http-error";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Record stdio launch approval using resolved cmd/args/env (matches connect-time checks). */
function trustResolvedStdioServer(
	projectId: string,
	server: MCPServer,
	db: CapaDatabase,
): void {
	if (!server.def?.cmd) return;
	const resolvedDef = resolveVariablesInObject(
		server.def,
		projectId,
		db,
	) as MCPServerDefinition;
	trustStdioServers(projectId, [{ ...server, def: resolvedDef }]);
}

export interface McpMetaRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
	getOrCreateMCPServer: (projectId: string) => CapaMCPServer | null;
	mcpServerState: McpServerStateManager;
}

export async function handleGetServerTools(
	deps: McpMetaRouteDeps,
	projectId: string,
	serverId: string,
): Promise<Response> {
	try {
		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const server = capabilities.servers.find((s) => s.id === serverId);
		if (!server) {
			return new Response(JSON.stringify({ error: "Server not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const enabled = deps.mcpServerState.isEnabled(projectId, serverId);
		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (!mcpServer) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		if (!enabled) {
			return new Response(
				JSON.stringify({ tools: [], enabled: false, connected: false }),
				{ headers: JSON_HEADERS },
			);
		}

		// Only connect when the user has explicitly enabled the server.
		const tools = await mcpServer.listServerTools(serverId, capabilities, {
			throwOnError: true,
			connect: true,
			timeoutMs: 10_000,
		});
		return new Response(
			JSON.stringify({ tools, enabled: true, connected: true }),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		const detail = error?.message ?? String(error);
		const needsAuth = /authentication failed|reconnect oauth2/i.test(detail);
		const message = needsAuth
			? `Authentication required for "${serverId}". Please reconnect this server's OAuth2 connection.`
			: `Server unreachable: "${serverId}" could not be contacted.`;
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleSetServerEnabled(
	deps: McpMetaRouteDeps,
	projectId: string,
	serverId: string,
	request: Request,
): Promise<Response> {
	try {
		let body: { enabled?: boolean };
		try {
			body = (await request.json()) as { enabled?: boolean };
		} catch {
			return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}

		if (typeof body.enabled !== "boolean") {
			return new Response(
				JSON.stringify({ error: 'Body must include boolean "enabled"' }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const server = capabilities.servers.find((s) => s.id === serverId);
		if (!server) {
			return new Response(JSON.stringify({ error: "Server not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (!mcpServer) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		if (body.enabled) {
			trustResolvedStdioServer(projectId, server, deps.db);

			deps.mcpServerState.setEnabled(projectId, serverId, true);

			try {
				await mcpServer.listServerTools(serverId, capabilities, {
					throwOnError: true,
					connect: true,
					timeoutMs: 15_000,
				});
			} catch (error: unknown) {
				// Keep the server enabled — tokens may still be valid and connect
				// can succeed later without forcing another OAuth round-trip.
				const detail = clientErrorMessage(error, "Failed to connect MCP server");
				const needsAuth = /authentication|oauth2|reconnect/i.test(detail);
				return new Response(
					JSON.stringify({
						serverId,
						enabled: true,
						connected: false,
						error: detail,
						needsAuth,
					}),
					{ headers: JSON_HEADERS },
				);
			}
		} else {
			deps.mcpServerState.setEnabled(projectId, serverId, false);
			await mcpServer.disconnectNonEnabledServers((id) =>
				deps.mcpServerState.isEnabled(projectId, id),
			);
		}

		const connected = body.enabled;
		return new Response(
			JSON.stringify({ serverId, enabled: body.enabled, connected }),
			{ headers: JSON_HEADERS },
		);
	} catch (error: unknown) {
		return new Response(
			JSON.stringify({ error: clientErrorMessage(error, "Request failed") }),
			{
				status: 500,
				headers: JSON_HEADERS,
			},
		);
	}
}

export async function handleGetSkillContent(
	deps: McpMetaRouteDeps,
	projectId: string,
	skillId: string,
): Promise<Response> {
	try {
		const project = deps.db.getProject(projectId);
		if (!project) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		let capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			try {
				const file = await detectCapabilitiesFile(project.path);
				if (file) {
					capabilities = await parseCapabilitiesFile(file.path, file.format);
				}
			} catch {
				// ignore
			}
		}
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const skill = (capabilities.skills ?? []).find((s) => s.id === skillId);
		if (!skill) {
			return new Response(JSON.stringify({ error: "Skill not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const { createAuthenticatedFetch } = await import(
			"../shared/authenticated-fetch"
		);
		const authFetch = createAuthenticatedFetch(deps.db);
		const resolved = await resolveSkillContentById(
			project.path,
			capabilities,
			skillId,
			authFetch,
			{ projectId },
		);
		if (!resolved) {
			return new Response(
				JSON.stringify({ error: "Skill content not available" }),
				{ status: 404, headers: JSON_HEADERS },
			);
		}

		return new Response(
			JSON.stringify({
				id: skillId,
				content: resolved.content,
				metadata: resolved.metadata,
				files: resolved.files,
			}),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGetShellTools(
	deps: McpMetaRouteDeps,
	projectId: string,
): Promise<Response> {
	try {
		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (!mcpServer) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const tools: ShellToolInfo[] =
			await mcpServer.getAllShellTools(capabilities);
		return new Response(JSON.stringify({ tools }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGetShellToolSchema(
	deps: McpMetaRouteDeps,
	projectId: string,
	toolId: string,
): Promise<Response> {
	try {
		if (!toolId) {
			return new Response(
				JSON.stringify({ error: 'Missing "tool" query parameter' }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		if (!capabilities) {
			return new Response(JSON.stringify({ error: "Project not configured" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (!mcpServer) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const schema = await mcpServer.getShellToolSchema(toolId, capabilities);
		return new Response(JSON.stringify(schema), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 502,
			headers: JSON_HEADERS,
		});
	}
}
