import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Capabilities } from "../types/capabilities";
import { getQualifiedToolName } from "../types/capabilities";
import type { MCPProxy } from "./mcp-proxy";
import { applyDefaultsToSchema } from "./mcp-tool-defaults";
import { convertToolToMCP } from "./mcp-tool-schema";

export interface ShellToolInfo {
	id: string;
	type: "command" | "mcp";
	/** For MCP tools: the server ID (without '@') */
	serverId?: string;
	/** For MCP tools: the server-level description from the capabilities file */
	serverDescription?: string;
	/** For command tools: optional group name for nesting in capa sh */
	group?: string;
	description: string;
	inputSchema: any;
	/** Default argument values from the tool definition (MCP tools only) */
	defaults?: Record<string, any>;
}

type SchemaLog = {
	failure: (message: string, ...args: any[]) => void;
	debug: (message: string, ...args: any[]) => void;
	warn: (message: string, ...args: any[]) => void;
};

/**
 * Return shell-tool metadata for the capa shell, regardless of toolExposure mode.
 *
 * This is the hot path for `capa sh` (top-level command list and group/subcommand
 * listing), so it must be fast and must NOT contact remote MCP servers. Command
 * tools carry their input schema (derived locally from the capabilities file);
 * MCP tools are returned WITHOUT an `inputSchema` — it is resolved lazily and
 * per-tool via {@link getShellToolSchema} only when the user runs the tool or asks
 * for its `--help`. That keeps one slow/down server from stalling the whole shell.
 */
export async function getAllShellTools(
	capabilities: Capabilities,
	cache: Map<string, MCPTool>,
	mcpProxy: MCPProxy,
	log: SchemaLog,
): Promise<ShellToolInfo[]> {
	const result: ShellToolInfo[] = [];
	for (const tool of capabilities.tools) {
		if (tool.type === "mcp") {
			const mcpDef = tool.def;
			const serverId = mcpDef.server.replace("@", "");
			const info: ShellToolInfo = {
				id: getQualifiedToolName(tool),
				type: "mcp",
				description: tool.description || "",
				// Resolved on demand — see getShellToolSchema.
				inputSchema: undefined,
				serverId,
			};
			const serverDef = capabilities.servers.find((s) => s.id === serverId);
			if (serverDef?.description) {
				info.serverDescription = serverDef.description;
			}
			if (mcpDef.defaults) {
				info.defaults = mcpDef.defaults;
			}
			result.push(info);
		} else {
			// Command tool — schema is built locally and is cheap, so include it.
			const mcpTool = await convertToolToMCP(
				tool,
				capabilities,
				cache,
				mcpProxy,
				log,
			);
			const info: ShellToolInfo = {
				id: getQualifiedToolName(tool),
				type: "command",
				description: mcpTool.description || "",
				inputSchema: mcpTool.inputSchema,
			};
			if (tool.group) {
				info.group = tool.group;
			}
			const def = tool.def;
			if (def.run.args) {
				const cmdDefaults: Record<string, any> = {};
				for (const arg of def.run.args) {
					if (arg.default !== undefined) {
						cmdDefaults[arg.name] = arg.default;
					}
				}
				if (Object.keys(cmdDefaults).length > 0) {
					info.defaults = cmdDefaults;
				}
			}
			result.push(info);
		}
	}
	return result;
}

/**
 * Resolve the input schema for a single shell tool on demand.
 *
 * Used by the capa shell when the user runs a specific tool or asks for its
 * `--help`. Unlike {@link getAllShellTools}, this DOES contact the remote MCP
 * server for `mcp` tools and throws a descriptive error if the server is
 * unreachable, times out, or doesn't expose the tool — so the shell can surface
 * the failure for that one tool without affecting the rest of the session.
 */
export async function getShellToolSchema(
	toolId: string,
	capabilities: Capabilities,
	cache: Map<string, MCPTool>,
	mcpProxy: MCPProxy,
	log: SchemaLog,
): Promise<{ description: string; inputSchema: any }> {
	const tool = capabilities.tools.find(
		(t) => getQualifiedToolName(t) === toolId,
	);
	if (!tool) {
		throw new Error(`Tool not found: ${toolId}`);
	}

	if (tool.type === "command") {
		const mcpTool = await convertToolToMCP(
			tool,
			capabilities,
			cache,
			mcpProxy,
			log,
		);
		return {
			description: mcpTool.description || "",
			inputSchema: mcpTool.inputSchema,
		};
	}

	const mcpDef = tool.def;
	const serverId = mcpDef.server.replace("@", "");
	const serverDef = capabilities.servers.find((s) => s.id === serverId);
	if (!serverDef) {
		throw new Error(`Server not found: ${serverId}`);
	}

	const remoteTools = await mcpProxy.listTools(serverId, serverDef.def, {
		throwOnError: true,
	});
	const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);
	if (!remoteTool) {
		const available = remoteTools.map((t: any) => t.name).join(", ");
		throw new Error(
			`Tool "${mcpDef.tool}" not found on server "${serverId}". Available tools: ${available || "(none)"}`,
		);
	}

	const inputSchema = remoteTool.inputSchema
		? JSON.parse(JSON.stringify(remoteTool.inputSchema))
		: { type: "object" as const, properties: {} };
	if (mcpDef.defaults) {
		applyDefaultsToSchema(inputSchema, mcpDef.defaults);
	}

	const description = remoteTool.description || `MCP tool: ${toolId}`;
	// Warm the shared cache so a subsequent tools/call doesn't re-fetch.
	cache.set(toolId, {
		name: toolId,
		description,
		inputSchema,
	});

	return { description, inputSchema };
}
