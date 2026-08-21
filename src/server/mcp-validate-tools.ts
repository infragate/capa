import type { Capabilities, Tool } from "../types/capabilities";
import { getQualifiedToolName } from "../types/capabilities";
import type { MCPProxy } from "./mcp-proxy";

export interface ToolValidationResult {
	toolId: string;
	success: boolean;
	error?: string;
	serverId?: string;
	remoteTool?: string;
	pendingAuth?: boolean; // True if validation was skipped due to pending OAuth2 authentication
}

/**
 * Progress events emitted by `validateTools` while it works through servers
 * in parallel. Consumers (e.g. the install CLI) use these to render live
 * counters while waiting for the full batch to resolve.
 */
export type ValidationProgressEvent =
	| {
			type: "validation_init";
			totalTools: number;
			totalServers: number;
			commandTools: number;
	  }
	| {
			type: "server_done";
			serverId: string;
			validated: number;
			total: number;
			success: number;
			failed: number;
	  };

/**
 * Validate tools and return validation results.
 *
 * Per-server tool lookups run in parallel: tools are grouped by serverId,
 * each server is hit once with a single `listTools()` round-trip, and the
 * requested tool names are matched against the returned set in memory.
 * This collapses N tool-level round-trips into M server-level round-trips
 * fanned out concurrently — a ~10x install-time win on projects with many
 * tools spread across a handful of servers.
 *
 * If `onProgress` is supplied, an initial `validation_init` event fires
 * before any network work, then one `server_done` event per server as its
 * batch resolves. Used by the install CLI to render a live N/M counter.
 */
export async function validateTools(
	capabilities: Capabilities,
	mcpProxy: MCPProxy,
	onProgress?: (event: ValidationProgressEvent) => void,
): Promise<ToolValidationResult[]> {
	const results: ToolValidationResult[] = [];
	const totalTools = capabilities.tools.length;

	// Command tools have no remote dependency; resolve them immediately.
	const cmdTools = capabilities.tools.filter((t) => t.type === "command");
	for (const tool of cmdTools) {
		results.push({ toolId: getQualifiedToolName(tool), success: true });
	}

	// Group MCP tools by server so we make one listTools call per server.
	const mcpTools = capabilities.tools.filter(
		(t): t is Extract<Tool, { type: "mcp" }> => t.type === "mcp",
	);
	const byServer = new Map<string, typeof mcpTools>();
	for (const tool of mcpTools) {
		const serverId = tool.def.server.replace("@", "");
		const bucket = byServer.get(serverId);
		if (bucket) {
			bucket.push(tool);
		} else {
			byServer.set(serverId, [tool]);
		}
	}

	onProgress?.({
		type: "validation_init",
		totalTools,
		totalServers: byServer.size,
		commandTools: cmdTools.length,
	});

	// Track running validated count for progress events. Each server's
	// batch lands atomically so the increments stay coherent under
	// Promise.all (single-threaded event loop, no real race).
	let validated = cmdTools.length;

	await Promise.all(
		[...byServer.entries()].map(async ([serverId, tools]) => {
			const serverDef = capabilities.servers.find((s) => s.id === serverId);
			const batch: ToolValidationResult[] = [];

			if (!serverDef) {
				for (const tool of tools) {
					batch.push({
						toolId: getQualifiedToolName(tool),
						success: false,
						error: `Server not found: ${serverId}`,
						serverId,
					});
				}
			} else {
				try {
					const remoteTools = await mcpProxy.listTools(
						serverId,
						serverDef.def,
						{ bypassEnabledCheck: true },
					);
					const remoteByName = new Map<string, any>(
						remoteTools.map((t: any) => [t.name, t]),
					);
					const availableNames = remoteTools.map((t: any) => t.name).join(", ");

					for (const tool of tools) {
						const mcpDef = tool.def;
						const qualifiedName = getQualifiedToolName(tool);
						if (remoteByName.has(mcpDef.tool)) {
							batch.push({
								toolId: qualifiedName,
								success: true,
								serverId,
								remoteTool: mcpDef.tool,
							});
						} else {
							batch.push({
								toolId: qualifiedName,
								success: false,
								error: `Tool "${mcpDef.tool}" not found on server "${serverId}". Available tools: ${availableNames || "(none)"}`,
								serverId,
								remoteTool: mcpDef.tool,
							});
						}
					}
				} catch (error: any) {
					for (const tool of tools) {
						const mcpDef = tool.def;
						batch.push({
							toolId: getQualifiedToolName(tool),
							success: false,
							error: `Failed to connect to server "${serverId}": ${error.message}`,
							serverId,
							remoteTool: mcpDef.tool,
						});
					}
				}
			}

			results.push(...batch);
			validated += batch.length;
			const success = batch.filter((r) => r.success).length;
			onProgress?.({
				type: "server_done",
				serverId,
				validated,
				total: totalTools,
				success,
				failed: batch.length - success,
			});
		}),
	);

	return results;
}
