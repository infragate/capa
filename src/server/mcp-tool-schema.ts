import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Capabilities, Tool } from "../types/capabilities";
import { getQualifiedToolName } from "../types/capabilities";
import type { MCPProxy } from "./mcp-proxy";
import { applyDefaultsToSchema } from "./mcp-tool-defaults";

type SchemaLog = {
	failure: (message: string, ...args: any[]) => void;
	debug: (message: string, ...args: any[]) => void;
	warn: (message: string, ...args: any[]) => void;
};

/**
 * Convert a capa tool definition into an MCP Tool, resolving remote schemas via
 * `mcpProxy` when needed. Results are stored in `cache` keyed by qualified name.
 */
export async function convertToolToMCP(
	tool: Tool,
	capabilities: Capabilities,
	cache: Map<string, MCPTool>,
	mcpProxy: MCPProxy,
	log: SchemaLog,
): Promise<MCPTool> {
	const qualifiedName = getQualifiedToolName(tool);

	if (cache.has(qualifiedName)) {
		return cache.get(qualifiedName)!;
	}

	if (tool.type === "command") {
		const def = tool.def;
		const properties: any = {};
		const required: string[] = [];

		if (def.run.args) {
			for (const arg of def.run.args) {
				const prop: any = {
					type: arg.type,
					description: arg.description,
				};
				if (arg.default !== undefined) {
					prop.default = arg.default;
				}
				properties[arg.name] = prop;
				if (arg.required !== false && arg.default === undefined) {
					required.push(arg.name);
				}
			}
		}

		const mcpTool: MCPTool = {
			name: qualifiedName,
			description: tool.description || `Command tool: ${tool.id}`,
			inputSchema: {
				type: "object" as const,
				properties,
				required,
			},
		};

		cache.set(qualifiedName, mcpTool);
		return mcpTool;
	}

	const mcpDef = tool.def;
	const serverId = mcpDef.server.replace("@", "");
	const serverDef = capabilities.servers.find((s) => s.id === serverId);

	if (!serverDef) {
		log.failure(`Server not found for tool ${tool.id}: ${serverId}`);
		const mcpTool: MCPTool = {
			name: qualifiedName,
			description: `MCP tool: ${qualifiedName} (server not found)`,
			inputSchema: {
				type: "object" as const,
				properties: {},
			},
		};
		cache.set(qualifiedName, mcpTool);
		return mcpTool;
	}

	try {
		const remoteTools = await mcpProxy.listTools(serverId, serverDef.def);
		const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);

		if (remoteTool) {
			log.debug(`Fetched schema for ${qualifiedName} from ${serverId}`);
			const inputSchema = remoteTool.inputSchema
				? JSON.parse(JSON.stringify(remoteTool.inputSchema))
				: { type: "object" as const, properties: {} };
			if (mcpDef.defaults) {
				applyDefaultsToSchema(inputSchema, mcpDef.defaults);
			}
			const mcpTool: MCPTool = {
				name: qualifiedName,
				description: remoteTool.description || `MCP tool: ${qualifiedName}`,
				inputSchema,
			};
			cache.set(qualifiedName, mcpTool);
			return mcpTool;
		}

		log.warn(`Tool ${mcpDef.tool} not found on server ${serverId}`);
		const mcpTool: MCPTool = {
			name: qualifiedName,
			description: `MCP tool: ${qualifiedName} (not found on remote server)`,
			inputSchema: {
				type: "object" as const,
				properties: {},
			},
		};
		cache.set(qualifiedName, mcpTool);
		return mcpTool;
	} catch (error: any) {
		log.failure(`Failed to fetch schema for ${qualifiedName}:`, error.message);
		const mcpTool: MCPTool = {
			name: qualifiedName,
			description: `MCP tool: ${qualifiedName}`,
			inputSchema: {
				type: "object" as const,
				properties: {},
			},
		};
		cache.set(qualifiedName, mcpTool);
		return mcpTool;
	}
}
