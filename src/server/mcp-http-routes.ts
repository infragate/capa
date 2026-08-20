import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { isAllowedOrigin } from "./cors-origin";
import { CapaMCPServer } from "./mcp-handler";
import type { McpServerStateManager } from "./mcp-server-state";
import type { SessionManager } from "./session-manager";
import {
	CAPA_CLIENT_HEADER,
	CAPA_SHELL_CLIENT,
	runWithMcpRequestClient,
	type ToolCallTracer,
} from "./tool-call-tracer";

export interface McpHttpRouteDeps {
	mcpServers: Map<string, CapaMCPServer>;
	db: CapaDatabase;
	sessionManager: SessionManager;
	toolCallTracer: ToolCallTracer;
	mcpServerStateManager: McpServerStateManager;
	serverHost: string;
	serverPort: number;
}

export function mcpHandlerHttpStatus(error: unknown): number {
	if (error instanceof SyntaxError) {
		return 400;
	}
	const status =
		(error as { status?: number; statusCode?: number })?.status ??
		(error as { status?: number; statusCode?: number })?.statusCode;
	if (typeof status === "number" && status >= 400 && status < 500) {
		return status;
	}
	return 500;
}

/**
 * Handle MCP protocol HTTP for `/{projectId}/mcp` and
 * `/{projectId}/agents/{agentId}/mcp`.
 */
export async function handleMcpHttp(
	deps: McpHttpRouteDeps,
	request: Request,
	projectId: string,
	agentId?: string,
): Promise<Response> {
	const mcpLogger = logger.child("MCP");
	const cacheKey = agentId ? `${projectId}:${agentId}` : projectId;

	let mcpServer = deps.mcpServers.get(cacheKey);

	if (!mcpServer) {
		const label = agentId
			? `project: ${projectId}, sub-agent: ${agentId}`
			: `project: ${projectId}`;
		mcpLogger.info(`Creating new MCP server for ${label}`);
		const project = deps.db.getProject(projectId);
		if (!project) {
			mcpLogger.warn("Project not found");
			return new Response("Project not found", { status: 404 });
		}

		mcpServer = new CapaMCPServer(
			deps.db,
			deps.sessionManager,
			projectId,
			project.path,
			agentId,
			deps.toolCallTracer,
			deps.mcpServerStateManager,
		);

		deps.mcpServers.set(cacheKey, mcpServer);
		mcpLogger.success("MCP server created");
	}

	const requestOrigin = request.headers.get("Origin");
	const originCheck = isAllowedOrigin(
		requestOrigin,
		deps.serverHost,
		deps.serverPort,
	);
	const corsHeaders: Record<string, string> = {
		"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
		"Access-Control-Allow-Headers": `Content-Type, ${CAPA_CLIENT_HEADER}`,
	};
	if (originCheck.origin) {
		corsHeaders["Access-Control-Allow-Origin"] = originCheck.origin;
	}

	if (request.method === "POST") {
		if (requestOrigin && !originCheck.allowed) {
			return new Response(
				`Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
				{ status: 403 },
			);
		}

		try {
			const message = await request.json();
			mcpLogger.debug(
				`${message.method || "notification"} (id: ${message.id || "none"})`,
			);

			const headerClient = request.headers.get(CAPA_CLIENT_HEADER)?.trim();
			const requestClient =
				headerClient === CAPA_SHELL_CLIENT ? CAPA_SHELL_CLIENT : null;

			const result = await runWithMcpRequestClient(requestClient, () =>
				mcpServer.handleMessage(message),
			);

			return new Response(JSON.stringify(result), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					...corsHeaders,
				},
			});
		} catch (error: any) {
			mcpLogger.failure(`Error: ${error.message}`);
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					error: {
						code: -32603,
						message: error.message || "Internal error",
					},
					id: null,
				}),
				{
					status: mcpHandlerHttpStatus(error),
					headers: {
						"Content-Type": "application/json",
						...corsHeaders,
					},
				},
			);
		}
	}

	if (request.method === "OPTIONS") {
		if (requestOrigin && !originCheck.allowed) {
			return new Response(
				`Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
				{ status: 403 },
			);
		}

		return new Response(null, {
			status: 204,
			headers: corsHeaders,
		});
	}

	return new Response("Method not allowed", { status: 405 });
}
