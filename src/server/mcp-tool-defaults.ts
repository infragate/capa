import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Remove defaulted parameters from the schema's `required` array and annotate
 * each property with a `default` value so MCP clients see them as optional.
 */
export function applyDefaultsToSchema(
	schema: any,
	defaults: Record<string, any>,
): void {
	const defaultKeys = Object.keys(defaults);
	if (defaultKeys.length === 0) return;
	if (Array.isArray(schema.required)) {
		schema.required = schema.required.filter(
			(r: string) => !defaultKeys.includes(r),
		);
	}
	if (schema.properties) {
		for (const key of defaultKeys) {
			if (schema.properties[key]) {
				schema.properties[key].default = defaults[key];
			}
		}
	}
}

/** Merge tool-level default args with caller-supplied args (caller wins). */
export function mergeDefaults(
	defaults: Record<string, any> | undefined,
	args: Record<string, any>,
): Record<string, any> {
	if (!defaults) return args;
	return { ...defaults, ...args };
}

/**
 * Build a compact function-style signature string for an MCP tool, used as the
 * response shape of `setup_tools`. Each call to `setup_tools` accumulates the
 * available tools, and a full schema per tool quickly bloats the context
 * window — so we emit signatures only and reserve the full schema for the
 * `call_tool` error path (where the agent has demonstrably called wrong).
 *
 * Format:  `tool_name(req1, req2, opt1?, opt2?)`
 *   - Properties listed in `required` come first, in the order they appear in
 *     `required`.
 *   - All other properties follow, suffixed with `?` to mark them optional.
 *   - Property order within the "remaining" group preserves the schema's
 *     `properties` declaration order so signatures are stable across calls.
 *   - Tools with no input schema render as `tool_name()`.
 */
export function buildToolSignature(
	tool: Pick<MCPTool, "name" | "inputSchema">,
): string {
	const schema: any = tool.inputSchema;
	const properties =
		schema && typeof schema === "object" ? schema.properties : undefined;
	if (!properties || typeof properties !== "object") {
		return `${tool.name}()`;
	}
	const requiredList: string[] = Array.isArray(schema.required)
		? schema.required
		: [];
	const requiredSet = new Set<string>(requiredList);
	const allProps = Object.keys(properties);

	const reqPart = requiredList.filter((name) => name in properties);
	const optPart = allProps
		.filter((name) => !requiredSet.has(name))
		.map((name) => `${name}?`);
	return `${tool.name}(${[...reqPart, ...optPart].join(", ")})`;
}

/**
 * Build the JSON payload returned by `setup_tools`. We return:
 *   - `tools`: an array of signature strings (see `buildToolSignature`).
 *   - `skills` / `activeSkills`: skills passed *this call* vs the accumulated
 *     set (so the agent can tell what's already active without parsing prior
 *     responses).
 *   - `hint`: a one-line reminder of how to inspect a tool's full schema
 *     (call it; on incorrect args the schema is returned).
 *
 * This payload is intentionally string-typed (not the MCP `Tool` shape) — the
 * tool-list-changed notification path already informs MCP-aware clients of
 * schema updates; this response is for the LLM's working context.
 */
export interface SetupToolsPayload {
	success: true;
	message: string;
	skills: string[];
	activeSkills: string[];
	tools: string[];
	hint: string;
}

export function buildSetupToolsPayload(
	requestedSkills: string[],
	activeSkills: string[],
	toolSignatures: string[],
): SetupToolsPayload {
	return {
		success: true,
		message:
			`Activated ${requestedSkills.length} skill(s); ` +
			`${activeSkills.length} skill(s) and ${toolSignatures.length} tool(s) now available.`,
		skills: requestedSkills,
		activeSkills,
		tools: toolSignatures,
		hint:
			"Tools are listed as `name(required, optional?)`. " +
			"Invoke with `call_tool`; if you pass wrong/missing args, the full input schema is returned in the error.",
	};
}

/**
 * Build the error payload returned by `call_tool` when a tool invocation
 * fails. When the failure is plausibly an arg/schema problem (tool exists and
 * was activated, but execution errored), include the full input schema so the
 * agent can self-correct without re-running `setup_tools` to discover it.
 */
export interface CallToolErrorPayload {
	error: string;
	tool?: string;
	schema?: unknown;
	hint?: string;
}

export function buildCallToolErrorPayload(
	message: string,
	schemaCtx?: { tool: Pick<MCPTool, "name" | "inputSchema" | "description"> },
): CallToolErrorPayload {
	if (!schemaCtx) return { error: message };
	const { tool } = schemaCtx;
	return {
		error: message,
		tool: tool.name,
		schema: tool.inputSchema,
		hint:
			`Retry \`call_tool\` with \`name: "${tool.name}"\` and a \`data\` object ` +
			`matching the schema above.`,
	};
}
