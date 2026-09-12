// Note: We use the low-level Server API instead of McpServer because we're implementing
// a custom HTTP-based transport and need fine-grained control over JSON-RPC message handling.
// This is an advanced use case where Server (not McpServer) is the appropriate choice.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	Tool as MCPTool,
} from "@modelcontextprotocol/sdk/types.js";
import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { CAPA_SERVER_ICONS } from "../shared/mcp-icons";
import { projectNameFromId } from "../shared/paths";
import type {
	Capabilities,
	MCPServerDefinition,
	Tool,
	ToolExposureMode,
} from "../types/capabilities";
import {
	getQualifiedToolName,
	normalizeToolName,
	resolveSubagentToolRefs,
} from "../types/capabilities";
import { VERSION } from "../version";
import { MCPProxy } from "./mcp-proxy";
import type { McpServerStateManager } from "./mcp-server-state";
import {
	getAllShellTools as getAllShellToolsImpl,
	getShellToolSchema as getShellToolSchemaImpl,
} from "./mcp-shell-tools";
import {
	buildCallToolErrorPayload,
	buildSetupToolsPayload,
	buildToolSignature,
	mergeDefaults,
} from "./mcp-tool-defaults";
import { convertToolToMCP as convertToolToMCPImpl } from "./mcp-tool-schema";
import {
	type ToolValidationResult,
	type ValidationProgressEvent,
	validateTools as validateToolsImpl,
} from "./mcp-validate-tools";
import type { SessionInfo } from "./session-manager";
import { SessionManager } from "./session-manager";
import {
	CAPA_SHELL_CLIENT,
	getMcpRequestClientName,
	previewFromToolResult,
	resolveToolCallSource,
	type ToolCallTracer,
} from "./tool-call-tracer";
import { CommandToolExecutor } from "./tool-executor";
import { buildToolCallText, extractCapaShellMeta } from "./tool-formatter";

export type { ShellToolInfo } from "./mcp-shell-tools";
export type {
	CallToolErrorPayload,
	SetupToolsPayload,
} from "./mcp-tool-defaults";
export {
	applyDefaultsToSchema,
	buildCallToolErrorPayload,
	buildSetupToolsPayload,
	buildToolSignature,
	mergeDefaults,
} from "./mcp-tool-defaults";
export type {
	ToolValidationResult,
	ValidationProgressEvent,
} from "./mcp-validate-tools";

/** Meta-tools exposed only when `toolExposure` is `on-demand`. */
const ON_DEMAND_META_TOOLS: MCPTool[] = [
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

type ToolCallResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

type ToolsCallOutcome =
	| { type: "ok"; result: ToolCallResult }
	| { type: "unavailable"; message: string }
	| { type: "not_found"; message: string }
	| { type: "internal"; message: string }
	| { type: "exception"; error: Error };

function toolTextError(message: string): {
	content: Array<{ type: "text"; text: string }>;
} {
	return {
		content: [{ type: "text", text: JSON.stringify({ error: message }) }],
	};
}

export class CapaMCPServer {
	private server: Server;
	private db: CapaDatabase;
	private sessionManager: SessionManager;
	private mcpProxy: MCPProxy;
	private projectId: string;
	private projectPath: string;
	/** Sub-agent ID — null means the main (unfiltered) agent endpoint. */
	private agentId: string | null;
	private sessionId: string | null = null;
	/** MCP clientInfo.name from the last initialize (e.g. capa-shell). */
	private clientName: string | null = null;
	private toolSchemaCache: Map<string, MCPTool> = new Map();
	private tracer: ToolCallTracer | null;
	private logger = logger.child("MCPHandler");

	constructor(
		db: CapaDatabase,
		sessionManager: SessionManager,
		projectId: string,
		projectPath: string,
		agentId?: string,
		tracer?: ToolCallTracer | null,
		mcpServerState?: McpServerStateManager,
	) {
		this.db = db;
		this.sessionManager = sessionManager;
		this.projectId = projectId;
		this.projectPath = projectPath;
		this.agentId = agentId ?? null;
		this.tracer = tracer ?? null;
		this.mcpProxy = new MCPProxy(db, projectId, projectPath, {
			isServerEnabled: (serverId) =>
				mcpServerState?.isEnabled(projectId, serverId) ?? true,
		});

		this.server = new Server(
			{
				name: `capa-${projectNameFromId(projectId)}`,
				version: VERSION,
				title: "capa",
				description: "An agentic skills and tools package manager",
				websiteUrl: "https://capa.sh",
				icons: CAPA_SERVER_ICONS,
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.setupHandlers();
	}

	/**
	 * Get the current session, recreating it transparently if it was expired/cleaned up.
	 * This prevents "Session not found" errors after idle timeouts.
	 */
	private ensureSession(): SessionInfo {
		if (this.sessionId) {
			const session = this.sessionManager.getSession(this.sessionId);
			if (session) {
				this.sessionManager.updateActivity(this.sessionId);
				return session;
			}
			this.logger.warn(
				`Session ${this.sessionId} expired, creating new session`,
			);
		}
		const session = this.sessionManager.createSession(this.projectId);
		this.sessionId = session.sessionId;
		return session;
	}

	private beginTrace(input: {
		kind: "setup_tools" | "call_tool" | "tool";
		toolName: string;
		metaTool?: string | null;
		args?: unknown;
	}): string | null {
		if (!this.tracer) return null;
		const clientName = getMcpRequestClientName() ?? this.clientName;
		return this.tracer.start({
			projectId: this.projectId,
			sessionId: this.sessionId,
			agentId: this.agentId,
			source: resolveToolCallSource(clientName),
			kind: input.kind,
			toolName: input.toolName,
			metaTool: input.metaTool ?? null,
			args: input.args,
		});
	}

	private finishTraceOk(traceId: string | null, result: unknown): void {
		if (!traceId || !this.tracer) return;
		const isError =
			result != null &&
			typeof result === "object" &&
			(result as { isError?: boolean }).isError === true;
		if (isError) {
			const preview = previewFromToolResult(result);
			this.tracer.finish(traceId, {
				status: "error",
				resultPreview: preview,
				errorMessage: preview,
			});
			return;
		}
		this.tracer.finish(traceId, {
			status: "ok",
			resultPreview: previewFromToolResult(result),
		});
	}

	private finishTraceError(
		traceId: string | null,
		errorMessage: string,
		result?: unknown,
	): void {
		if (!traceId || !this.tracer) return;
		this.tracer.finish(traceId, {
			status: "error",
			errorMessage,
			resultPreview:
				result !== undefined ? previewFromToolResult(result) : undefined,
		});
	}

	/**
	 * Return the set of qualified tool names this endpoint may expose.
	 * Returns null for the main agent endpoint (no filtering) or when the
	 * sub-agent ID is not found in the current capabilities.
	 */
	private getAgentAllowedToolIds(
		capabilities: Capabilities,
	): Set<string> | null {
		if (!this.agentId || !capabilities.subagents) return null;
		const subAgent = capabilities.subagents.find((a) => a.id === this.agentId);
		if (!subAgent) return null;
		const allowed = new Set<string>();
		for (const ref of subAgent.tools) {
			for (const tool of resolveSubagentToolRefs(ref, capabilities.tools)) {
				allowed.add(getQualifiedToolName(tool));
			}
		}
		return allowed;
	}

	/**
	 * Build the tools/list payload for the current project exposure mode.
	 * Shared by the SDK `ListTools` handler and HTTP `handleMessage`.
	 */
	private async buildToolsListResult(): Promise<{ tools: MCPTool[] }> {
		const capabilities = this.sessionManager.getProjectCapabilities(
			this.projectId,
		);
		const toolExposureMode: ToolExposureMode =
			capabilities?.options?.toolExposure || "expose-all";
		this.logger.debug(`Tool exposure mode: ${toolExposureMode}`);

		if (toolExposureMode === "none") {
			// Project opted out of MCP-driven tool exposure. The agent is
			// expected to discover and run tools via `capa sh` instead.
			this.logger.info(
				"Tool exposure disabled (none) — returning empty tools list",
			);
			return { tools: [] };
		}

		if (toolExposureMode === "expose-all") {
			const tools: MCPTool[] = [];
			if (capabilities) {
				const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
				const allToolIds = this.sessionManager.getAllRequiredToolsForProject(
					this.projectId,
				);
				this.logger.debug(
					`Exposing ${allowedToolIds ? allowedToolIds.size : allToolIds.length} tool(s) (allowedToolIds=${allowedToolIds ? "set" : "null"})`,
				);
				for (const qualifiedName of allToolIds) {
					if (allowedToolIds && !allowedToolIds.has(qualifiedName)) continue;
					const tool = capabilities.tools.find(
						(t) => getQualifiedToolName(t) === qualifiedName,
					);
					if (tool) {
						tools.push(await this.convertToolToMCP(tool, capabilities));
					}
				}
			}
			// Note: setup_tools is NOT included — all tools are already visible
			return { tools };
		}

		// On-demand: only meta-tools
		return { tools: ON_DEMAND_META_TOOLS };
	}

	/**
	 * Shared tools/call routing for SDK and HTTP adapters.
	 * `style` preserves historical error-shape quirks between transports
	 * (SDK soft content vs HTTP JSON-RPC errors; HTTP always accepts setup_tools).
	 */
	private async resolveToolsCall(
		name: string,
		args: Record<string, unknown> | undefined,
		style: "sdk" | "http",
	): Promise<ToolsCallOutcome> {
		const { cleanArgs, skipFormatter } = extractCapaShellMeta(
			(args ?? {}) as Record<string, any>,
		);
		const capabilities = this.sessionManager.getProjectCapabilities(
			this.projectId,
		);
		const toolExposureMode: ToolExposureMode =
			capabilities?.options?.toolExposure || "expose-all";

		if (name === "setup_tools") {
			// HTTP historically accepts setup_tools in any mode; SDK only in on-demand.
			if (toolExposureMode === "on-demand" || style === "http") {
				if (style === "http") {
					this.logger.info(
						`Activating skills: ${(cleanArgs as { skills?: string[] }).skills?.join(", ") ?? ""}`,
					);
				}
				return {
					type: "ok",
					result: await this.handleSetupTools(
						cleanArgs as { skills: string[] },
					),
				};
			}
			if (toolExposureMode === "expose-all") {
				this.logger.warn(`Meta-tool ${name} called in expose-all mode`);
				return {
					type: "unavailable",
					message: `The meta-tool "${name}" is only available in on-demand mode. Your project is configured for expose-all mode.`,
				};
			}
			// mode === 'none': fall through to direct tool lookup (SDK quirk)
		}

		if (name === "call_tool") {
			if (toolExposureMode === "on-demand") {
				return {
					type: "ok",
					result: await this.handleCallTool(
						cleanArgs as { name: string; data: object },
					),
				};
			}
			if (style === "http") {
				this.logger.warn("call_tool is only available in on-demand mode");
				return {
					type: "unavailable",
					message: "call_tool is only available in on-demand mode",
				};
			}
			if (toolExposureMode === "expose-all") {
				this.logger.warn(`Meta-tool ${name} called in expose-all mode`);
				return {
					type: "unavailable",
					message: `The meta-tool "${name}" is only available in on-demand mode. Your project is configured for expose-all mode.`,
				};
			}
			// mode === 'none': fall through (SDK quirk)
		}

		if (toolExposureMode === "on-demand") {
			this.ensureSession();
		}

		if (this.agentId && capabilities) {
			const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
			if (allowedToolIds) {
				const normalizedName = normalizeToolName(name);
				const isAllowed = [...allowedToolIds].some(
					(id) => normalizeToolName(id) === normalizedName,
				);
				if (!isAllowed) {
					if (style === "http") {
						this.logger.warn(
							`Sub-agent "${this.agentId}" attempted to call unauthorized tool: ${name}`,
						);
					}
					const denied = toolTextError(
						`Tool "${name}" is not available on this sub-agent endpoint (${this.agentId}). Use the main capa endpoint to access all tools.`,
					);
					const deniedTraceId = this.beginTrace({
						kind: "tool",
						toolName: name,
						args: cleanArgs,
					});
					this.finishTraceError(
						deniedTraceId,
						`Tool not available on sub-agent: ${name}`,
						denied,
					);
					return { type: "ok", result: denied };
				}
			}
		}

		const toolDef = this.sessionManager.getToolDefinition(this.projectId, name);
		const traceId = this.beginTrace({
			kind: "tool",
			toolName: name,
			args: cleanArgs,
		});
		if (!toolDef) {
			const message = `Tool not found: ${name}`;
			if (style === "http") {
				this.logger.warn("Tool not found");
				this.finishTraceError(traceId, message);
				return { type: "not_found", message };
			}
			const missing = toolTextError(message);
			this.finishTraceError(traceId, message, missing);
			return { type: "ok", result: missing };
		}

		if (style === "http") {
			this.logger.debug(`Tool type: ${toolDef.type}`);
		}

		try {
			let result: unknown;
			if (toolDef.type === "command") {
				if (style === "http") this.logger.debug("Executing command tool...");
				const executor = new CommandToolExecutor(
					this.db,
					this.projectId,
					this.projectPath,
				);
				result = await executor.execute(name, toolDef.def, cleanArgs);
				if (style === "http") {
					this.logger.debug(
						`Command executed, success: ${(result as { success?: boolean }).success}`,
					);
				}
			} else {
				if (style === "http") this.logger.debug("Executing MCP tool...");
				const mcpDef = toolDef.def;
				const caps =
					capabilities ??
					this.sessionManager.getProjectCapabilities(this.projectId);
				if (!caps) {
					const message = "Project capabilities not found";
					if (style === "http") {
						this.logger.warn(message);
						this.finishTraceError(traceId, message);
						return { type: "internal", message };
					}
					const missingCaps = toolTextError(message);
					this.finishTraceError(traceId, message, missingCaps);
					return { type: "ok", result: missingCaps };
				}

				const serverId = mcpDef.server.replace("@", "");
				const serverDef = caps.servers.find((s) => s.id === serverId);
				if (!serverDef) {
					const message = `Server not found: ${serverId}`;
					if (style === "http") {
						this.logger.warn(message);
						this.finishTraceError(traceId, message);
						return { type: "internal", message };
					}
					const missingServer = toolTextError(message);
					this.finishTraceError(traceId, message, missingServer);
					return { type: "ok", result: missingServer };
				}

				if (style === "http") {
					this.logger.debug(`Using MCP server: ${serverId}`);
				}
				result = await this.mcpProxy.executeTool(
					name,
					mcpDef,
					serverDef.def,
					mergeDefaults(mcpDef.defaults, cleanArgs),
				);
				if (style === "http") this.logger.debug("MCP tool executed");
			}

			const content = await this.buildToolCallContent(result, toolDef, {
				skipFormatter,
			});
			this.finishTraceOk(traceId, content);
			return { type: "ok", result: content };
		} catch (error: any) {
			const message = error?.message || "Tool execution failed";
			this.finishTraceError(traceId, message);
			if (style === "http") {
				this.logger.failure(`Tool execution error: ${error.message}`);
				return {
					type: "exception",
					error: error instanceof Error ? error : new Error(message),
				};
			}
			throw error;
		}
	}

	private setupHandlers(): void {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return await this.buildToolsListResult();
		});

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const outcome = await this.resolveToolsCall(
				request.params.name,
				request.params.arguments as Record<string, unknown> | undefined,
				"sdk",
			);
			switch (outcome.type) {
				case "ok":
					return outcome.result;
				case "unavailable":
				case "not_found":
				case "internal":
					return toolTextError(outcome.message);
				case "exception":
					throw outcome.error;
				default: {
					const _exhaustive: never = outcome;
					return _exhaustive;
				}
			}
		});
	}

	private async handleSetupTools(args: { skills: string[] }): Promise<any> {
		this.ensureSession();
		const traceId = this.beginTrace({
			kind: "setup_tools",
			toolName: "setup_tools",
			metaTool: "setup_tools",
			args,
		});
		try {
			const capabilities = this.sessionManager.getProjectCapabilities(
				this.projectId,
			);
			const toolIds = this.sessionManager.setupTools(
				this.sessionId!,
				args.skills,
				capabilities ? this.getAgentAllowedToolIds(capabilities) : null,
			);
			const signatures = await this.buildToolSignaturesFor(toolIds);
			// `setupTools` updates the session's activeSkills set; read it back so
			// we report the merged list (not just this call's skills) to the agent.
			const activeSkills =
				this.sessionManager.getSession(this.sessionId!)?.activeSkills ??
				args.skills;

			// Send tools/list_changed when a live MCP transport is attached.
			// The HTTP handleMessage path has no persistent client transport, so
			// the SDK throws "Not connected" — that's expected and ignored.
			try {
				await this.server.notification({
					method: "notifications/tools/list_changed",
					params: {},
				});
			} catch {
				/* no connected transport */
			}

			const payload = buildSetupToolsPayload(
				args.skills,
				activeSkills,
				signatures,
			);
			const result = {
				content: [{ type: "text", text: JSON.stringify(payload) }],
			};
			this.finishTraceOk(traceId, result);
			return result;
		} catch (error: any) {
			const errorMessage = this.formatSetupToolsError(error);
			// Per the MCP spec, tool execution failures are reported with
			// `isError: true` on the result so the LLM sees the text content —
			// keep `setup_tools` consistent with the `call_tool` error path so
			// clients don't have to special-case the meta-tools.
			const result = {
				content: [
					{ type: "text", text: JSON.stringify({ error: errorMessage }) },
				],
				isError: true,
			};
			this.finishTraceError(traceId, errorMessage, result);
			return result;
		}
	}

	/**
	 * Resolve a list of qualified tool names to compact signature strings.
	 * Applies the sub-agent allow-list (if any) and skips tools that have no
	 * matching definition in the current capabilities snapshot.
	 */
	private async buildToolSignaturesFor(toolIds: string[]): Promise<string[]> {
		const capabilities = this.sessionManager.getProjectCapabilities(
			this.projectId,
		);
		if (!capabilities) return [];
		const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
		const signatures: string[] = [];
		for (const qualifiedName of toolIds) {
			if (allowedToolIds && !allowedToolIds.has(qualifiedName)) continue;
			const tool = capabilities.tools.find(
				(t) => getQualifiedToolName(t) === qualifiedName,
			);
			if (!tool) continue;
			const mcpTool = await this.convertToolToMCP(tool, capabilities);
			signatures.push(buildToolSignature(mcpTool));
		}
		return signatures;
	}

	/**
	 * Format an error from `SessionManager.setupTools` for the user. Adds the
	 * list of available skill ids when the failure was an unknown skill so the
	 * agent can recover without a separate discovery call.
	 */
	private formatSetupToolsError(error: any): string {
		const baseMessage = error?.message || "Failed to setup tools";
		if (
			typeof baseMessage !== "string" ||
			!baseMessage.startsWith("Skill not found:")
		) {
			return baseMessage;
		}
		const capabilities = this.sessionManager.getProjectCapabilities(
			this.projectId,
		);
		if (capabilities && capabilities.skills.length > 0) {
			const availableSkills = capabilities.skills.map((s) => s.id).join(", ");
			return `${baseMessage}. Available skills: ${availableSkills}`;
		}
		return baseMessage;
	}

	/**
	 * Look up the full MCP tool form (including resolved inputSchema) for a
	 * tool name as the agent sent it. Returns null when no matching tool exists
	 * in the current capabilities (e.g. the agent invented a name) so callers
	 * can degrade to a schema-less error.
	 *
	 * Uses the same dot/underscore normalization as `tools/call` so a call like
	 * `brave_search` resolves to the canonical `brave.search` schema.
	 */
	private async tryGetToolSchema(toolName: string): Promise<MCPTool | null> {
		const capabilities = this.sessionManager.getProjectCapabilities(
			this.projectId,
		);
		if (!capabilities) return null;
		const normalized = normalizeToolName(toolName);
		const tool = capabilities.tools.find(
			(t) => normalizeToolName(getQualifiedToolName(t)) === normalized,
		);
		if (!tool) return null;
		try {
			return await this.convertToolToMCP(tool, capabilities);
		} catch {
			// Schema lookup is best-effort — never let it mask the original error.
			return null;
		}
	}

	/**
	 * Build a content-wrapped `CallToolResult` for an error. Per the MCP spec
	 * tool-execution failures are reported with `isError: true` on the result
	 * (not as JSON-RPC errors) so the LLM sees the text content. We embed the
	 * full input schema in the text whenever we can identify the target tool —
	 * that's the whole point of slimming `setup_tools`: keep the schema close
	 * to where the agent actually needs it, not bloating every activation.
	 */
	private async buildCallToolErrorResult(
		toolName: string | undefined,
		message: string,
		options: { includeSchema?: boolean } = {},
	): Promise<{
		content: Array<{ type: string; text: string }>;
		isError: true;
	}> {
		const includeSchema = options.includeSchema ?? true;
		const mcpTool =
			includeSchema && toolName ? await this.tryGetToolSchema(toolName) : null;
		const payload = buildCallToolErrorPayload(
			message,
			mcpTool ? { tool: mcpTool } : undefined,
		);
		return {
			content: [{ type: "text", text: JSON.stringify(payload) }],
			isError: true,
		};
	}

	private async handleCallTool(args: {
		name: string;
		data: object;
	}): Promise<any> {
		const toolName = args.name;
		const { cleanArgs: toolData, skipFormatter } = extractCapaShellMeta(
			(args.data ?? {}) as Record<string, any>,
		);
		const session = this.ensureSession();
		let traceId: string | null = null;
		try {
			this.logger.info(`Calling tool via call_tool: ${toolName}`);
			this.logger.debug(`Tool data: ${JSON.stringify(toolData)}`);

			// Find tool definition
			const toolDef = this.sessionManager.getToolDefinition(
				this.projectId,
				toolName,
			);
			traceId = this.beginTrace({
				kind: "call_tool",
				toolName,
				metaTool: "call_tool",
				args: { name: toolName, data: toolData },
			});
			if (!toolDef) {
				this.logger.warn(`Tool not found: ${toolName}`);
				// No schema attached — by definition we don't have a matching tool.
				const result = await this.buildCallToolErrorResult(
					toolName,
					`Tool not found: ${toolName}. Make sure you've called setup_tools to activate the required skills.`,
					{ includeSchema: false },
				);
				this.finishTraceError(traceId, `Tool not found: ${toolName}`, result);
				return result;
			}

			// Check if tool is in available tools for the session (normalize for dot/underscore compat)
			const normalizedToolName = normalizeToolName(toolName);

			// On a sub-agent endpoint the allow-list is the authority: `call_tool`
			// otherwise authorizes purely by session activation, which the direct
			// tools/call path checks before dispatch and this one did not.
			const agentCapabilities = this.agentId
				? this.sessionManager.getProjectCapabilities(this.projectId)
				: null;
			const agentAllowed = agentCapabilities
				? this.getAgentAllowedToolIds(agentCapabilities)
				: null;
			if (
				agentAllowed &&
				![...agentAllowed].some(
					(id) => normalizeToolName(id) === normalizedToolName,
				)
			) {
				this.logger.warn(
					`Sub-agent "${this.agentId}" attempted to call unauthorized tool: ${toolName}`,
				);
				const result = await this.buildCallToolErrorResult(
					toolName,
					`Tool "${toolName}" is not available on this sub-agent endpoint (${this.agentId}). Use the main capa endpoint to access all tools.`,
					{ includeSchema: false },
				);
				this.finishTraceError(
					traceId,
					`Tool not available on sub-agent: ${toolName}`,
					result,
				);
				return result;
			}

			if (
				!session.availableTools.some(
					(t) => normalizeToolName(t) === normalizedToolName,
				)
			) {
				this.logger.warn(`Tool not activated: ${toolName}`);
				// The tool exists but isn't activated — `setup_tools` is the next
				// step, so don't pre-emptively dump the schema and confuse the agent.
				const result = await this.buildCallToolErrorResult(
					toolName,
					`Tool "${toolName}" is not activated. Call setup_tools with the appropriate skills first.`,
					{ includeSchema: false },
				);
				this.finishTraceError(
					traceId,
					`Tool not activated: ${toolName}`,
					result,
				);
				return result;
			}

			this.logger.debug(`Tool type: ${toolDef.type}`);

			// Execute tool based on type
			let result: any;
			if (toolDef.type === "command") {
				this.logger.debug("Executing command tool...");
				const executor = new CommandToolExecutor(
					this.db,
					this.projectId,
					this.projectPath,
				);
				result = await executor.execute(
					toolName,
					toolDef.def,
					toolData as Record<string, any>,
				);
				this.logger.debug(`Command executed, success: ${result.success}`);
				// Command-tool failures land here as `{success: false, error}` (e.g.
				// "Missing required argument: title") — they don't throw. Route them
				// through the error helper so the agent gets the full schema back and
				// can self-correct on the next call.
				if (result && result.success === false) {
					const errResult = await this.buildCallToolErrorResult(
						toolName,
						result.error || "Command tool failed",
					);
					this.finishTraceError(
						traceId,
						result.error || "Command tool failed",
						errResult,
					);
					return errResult;
				}
			} else if (toolDef.type === "mcp") {
				this.logger.debug("Executing MCP tool...");
				const mcpDef = toolDef.def;
				const capabilities = this.sessionManager.getProjectCapabilities(
					this.projectId,
				);
				if (!capabilities) {
					this.logger.warn("Project capabilities not found");
					const errResult = await this.buildCallToolErrorResult(
						toolName,
						"Project capabilities not found",
						{ includeSchema: false },
					);
					this.finishTraceError(
						traceId,
						"Project capabilities not found",
						errResult,
					);
					return errResult;
				}

				// Find server definition
				const serverId = mcpDef.server.replace("@", "");
				const serverDef = capabilities.servers.find((s) => s.id === serverId);
				if (!serverDef) {
					this.logger.warn(`Server not found: ${serverId}`);
					const errResult = await this.buildCallToolErrorResult(
						toolName,
						`Server not found: ${serverId}`,
						{ includeSchema: false },
					);
					this.finishTraceError(
						traceId,
						`Server not found: ${serverId}`,
						errResult,
					);
					return errResult;
				}

				this.logger.debug(`Using MCP server: ${serverId}`);
				result = await this.mcpProxy.executeTool(
					toolName,
					mcpDef,
					serverDef.def,
					mergeDefaults(mcpDef.defaults, toolData),
				);
				this.logger.debug("MCP tool executed");
			}

			const content = await this.buildToolCallContent(result, toolDef, {
				skipFormatter,
			});
			this.finishTraceOk(traceId, content);
			return content;
		} catch (error: any) {
			this.logger.failure(`call_tool execution error: ${error.message}`);
			// Likely an arg/schema problem — attach the schema so the agent can retry.
			const errResult = await this.buildCallToolErrorResult(
				toolName,
				error?.message || "Tool execution failed",
			);
			this.finishTraceError(
				traceId,
				error?.message || "Tool execution failed",
				errResult,
			);
			return errResult;
		}
	}

	/**
	 * List tools available on a specific MCP server by ID.
	 * Returns the raw MCP tool list (name, description, inputSchema).
	 */
	async listServerTools(
		serverId: string,
		capabilities: Capabilities,
		options: {
			throwOnError?: boolean;
			connect?: boolean;
			timeoutMs?: number;
			bypassEnabledCheck?: boolean;
		} = {},
	): Promise<any[]> {
		const serverDef = capabilities.servers.find((s) => s.id === serverId);
		if (!serverDef) return [];
		return await this.mcpProxy.listTools(serverId, serverDef.def, options);
	}

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
	async getAllShellTools(capabilities: Capabilities) {
		return getAllShellToolsImpl(
			capabilities,
			this.toolSchemaCache,
			this.mcpProxy,
			this.logger,
		);
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
	async getShellToolSchema(toolId: string, capabilities: Capabilities) {
		return getShellToolSchemaImpl(
			toolId,
			capabilities,
			this.toolSchemaCache,
			this.mcpProxy,
			this.logger,
		);
	}

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
	async validateTools(
		capabilities: Capabilities,
		onProgress?: (event: ValidationProgressEvent) => void,
	): Promise<ToolValidationResult[]> {
		return validateToolsImpl(capabilities, this.mcpProxy, onProgress);
	}

	private async convertToolToMCP(
		tool: Tool,
		capabilities: Capabilities,
	): Promise<MCPTool> {
		return convertToolToMCPImpl(
			tool,
			capabilities,
			this.toolSchemaCache,
			this.mcpProxy,
			this.logger,
		);
	}

	/**
	 * Build the MCP content payload for a tool execution, applying an optional
	 * formatter for MCP tools unless bypassed via `capa sh --raw`.
	 *
	 * Executor failures (`{ success: false, error }`) are returned with
	 * `isError: true` so callers (and activity traces) treat them as failures.
	 */
	private async buildToolCallContent(
		result: unknown,
		toolDef: Tool,
		options?: { skipFormatter?: boolean },
	): Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}> {
		const failed =
			result != null &&
			typeof result === "object" &&
			"success" in result &&
			(result as { success: unknown }).success === false;
		const text = await buildToolCallText(result, toolDef, options);
		if (failed) {
			return { content: [{ type: "text", text }], isError: true };
		}
		return { content: [{ type: "text", text }] };
	}

	getServer(): Server {
		return this.server;
	}

	/**
	 * Handle a JSON-RPC message from HTTP transport
	 */
	async handleMessage(message: any): Promise<any> {
		// Handle initialization
		if (message.method === "initialize") {
			this.logger.info("Initialize request");
			const rawClientName = message.params?.clientInfo?.name;
			const clientName =
				typeof rawClientName === "string" && rawClientName.trim()
					? rawClientName.trim()
					: null;
			// capa-shell must not stick on the shared per-project MCP server —
			// otherwise IDE call_tool/setup_tools inherit source "shell".
			// capa sh labels traces via X-Capa-Client / request ALS instead.
			if (clientName && clientName !== CAPA_SHELL_CLIENT) {
				this.clientName = clientName;
			}
			this.ensureSession();
			this.logger.debug(`Session ID: ${this.sessionId}`);
			const effectiveClient = getMcpRequestClientName() ?? clientName;
			if (effectiveClient) {
				this.logger.debug(`Client: ${effectiveClient}`);
			}

			return {
				jsonrpc: "2.0",
				id: message.id,
				result: {
					protocolVersion: "2025-11-25",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: `capa-${projectNameFromId(this.projectId)}`,
						title: "capa",
						version: VERSION,
						description: "An agentic skills and tools package manager",
						websiteUrl: "https://capa.sh",
						icons: CAPA_SERVER_ICONS,
					},
				},
			};
		}

		// Handle initialized notification
		if (message.method === "notifications/initialized") {
			this.logger.debug("Initialized notification");
			return {
				jsonrpc: "2.0",
				result: {},
			};
		}

		// Handle ping (liveness check — https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping)
		if (message.method === "ping") {
			this.logger.debug("Ping request");
			return {
				jsonrpc: "2.0",
				id: message.id,
				result: {},
			};
		}

		// Handle tools/list
		if (message.method === "tools/list") {
			this.logger.info("List tools request");
			const result = await this.buildToolsListResult();
			this.logger.info(
				`Returning ${result.tools.length} tool(s): ${result.tools.map((t) => t.name).join(", ")}`,
			);
			return {
				jsonrpc: "2.0",
				id: message.id,
				result,
			};
		}

		// Handle tools/call
		if (message.method === "tools/call") {
			const { name, arguments: args } = message.params;
			this.logger.info(`Call tool: ${name}`);
			this.logger.debug(`Arguments: ${JSON.stringify(args)}`);

			const outcome = await this.resolveToolsCall(
				name,
				args as Record<string, unknown> | undefined,
				"http",
			);
			switch (outcome.type) {
				case "ok":
					return {
						jsonrpc: "2.0",
						id: message.id,
						result: outcome.result,
					};
				case "unavailable":
				case "not_found":
					return {
						jsonrpc: "2.0",
						id: message.id,
						error: { code: -32601, message: outcome.message },
					};
				case "internal":
					return {
						jsonrpc: "2.0",
						id: message.id,
						error: { code: -32603, message: outcome.message },
					};
				case "exception":
					return {
						jsonrpc: "2.0",
						id: message.id,
						error: {
							code: -32603,
							message: outcome.error.message || "Tool execution failed",
						},
					};
				default: {
					const _exhaustive: never = outcome;
					return _exhaustive;
				}
			}
		}

		// Unknown method
		this.logger.warn(`Unknown method: ${message.method}`);
		return {
			jsonrpc: "2.0",
			id: message.id,
			error: {
				code: -32601,
				message: `Method not found: ${message.method}`,
			},
		};
	}

	async disconnectNonEnabledServers(
		isEnabled: (serverId: string) => boolean,
	): Promise<void> {
		for (const serverId of this.mcpProxy.getConnectedServerIds()) {
			if (!isEnabled(serverId)) {
				await this.mcpProxy.closeServer(serverId);
			}
		}
	}

	async close(): Promise<void> {
		await this.mcpProxy.closeAll();
		await this.server.close();
	}

	/**
	 * Close cached MCP children whose server defs changed or were removed.
	 * Invoked after capabilities reload / configure so version bumps take
	 * effect without a full capa restart.
	 */
	async syncCachedMcpClients(
		servers: Array<{ id: string; def: MCPServerDefinition }>,
		previousServers?: Array<{ id: string; def: MCPServerDefinition }>,
	): Promise<void> {
		await this.mcpProxy.syncCachedServers(servers, previousServers);
	}
}
