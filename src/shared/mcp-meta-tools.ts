/**
 * Schemas of capa's discovery meta-tools, returned by `tools/list` in the
 * `on-demand` and `search` exposure modes. Plain data with no server
 * dependencies, so the web UI can estimate their token cost too.
 */

export interface MetaToolSchema {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, { type: string; description?: string; items?: { type: string } }>;
		required: string[];
	};
}

/** Meta-tools exposed only when `toolExposure` is `on-demand`. */
export const ON_DEMAND_META_TOOLS: MetaToolSchema[] = [
	{
		name: "setup_tools",
		description:
			"Activate skills and load their required tools. Should be called when the agent learns (loads) a skill. Returns a compact signature list (`tool_name(required, optional?)`) for every activated tool — full input schemas are returned in the `call_tool` error response when a call is invalid.",
		inputSchema: {
			type: "object",
			properties: {
				skills: {
					type: "array",
					items: { type: "string" },
					description: "List of skill IDs to activate",
				},
			},
			required: ["skills"],
		},
	},
	{
		name: "call_tool",
		description:
			"Call any activated tool by name. Use `setup_tools` first to discover available tools (returned as compact signatures). If you pass invalid or missing args the full input schema is returned in the error so you can retry.",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The name of the tool to call",
				},
				data: {
					type: "object",
					description: "The input data for the tool",
				},
			},
			required: ["name", "data"],
		},
	},
];

/** Meta-tools exposed only when `toolExposure` is `search`. */
export const SEARCH_META_TOOLS: MetaToolSchema[] = [
	{
		name: "search",
		description:
			"Find tools for the task at hand by keyword — e.g. search('open a pull request'). Returns the best matches as compact signatures (`tool_name(required, optional?)`) with their descriptions, and makes them callable with `call_tool`. Search again with different words whenever the task changes; matches accumulate.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Words describing what you need to do (tool names, verbs, the system you want to touch).",
				},
				limit: {
					type: "number",
					description: "Maximum number of tools to return (default 10).",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "call_tool",
		description:
			"Call any tool that `search` returned, by name. If you pass invalid or missing args the full input schema is returned in the error so you can retry.",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The name of the tool to call",
				},
				data: {
					type: "object",
					description: "The input data for the tool",
				},
			},
			required: ["name", "data"],
		},
	},
];
