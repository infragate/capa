import type { CapaDatabase } from "../db/database";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { detectCapabilitiesFile } from "../shared/paths";
import type { Capabilities } from "../types/capabilities";
import type { CapaMCPServer, ShellToolInfo } from "./mcp-handler";
import type { SessionManager } from "./session-manager";
import {
	resolveSkillContentById,
	resolveSkillDescription,
	resolveSkillSourceUrl,
} from "./skill-content";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface McpMetaRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
	getOrCreateMCPServer: (projectId: string) => CapaMCPServer | null;
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

		const mcpServer = deps.getOrCreateMCPServer(projectId);
		if (!mcpServer) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		const tools = await mcpServer.listServerTools(serverId, capabilities, {
			throwOnError: true,
		});
		return new Response(JSON.stringify({ tools }), {
			headers: JSON_HEADERS,
		});
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
