// Note: We use the low-level Server API instead of McpServer because we're implementing
// a custom HTTP-based transport and need fine-grained control over JSON-RPC message handling.
// This is an advanced use case where Server (not McpServer) is the appropriate choice.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool as MCPTool,
} from '@modelcontextprotocol/sdk/types.js';
import type { CapaDatabase } from '../db/database';
import type { Capabilities, Tool, ToolCommandDefinition, ToolMCPDefinition } from '../types/capabilities';
import { getQualifiedToolName, normalizeToolName } from '../types/capabilities';
import { SessionManager } from './session-manager';
import type { SessionInfo } from './session-manager';
import { CommandToolExecutor } from './tool-executor';
import { MCPProxy } from './mcp-proxy';
import { VERSION } from '../version';
import { logger } from '../shared/logger';

export interface ShellToolInfo {
  id: string;
  type: 'command' | 'mcp';
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

export interface ToolValidationResult {
  toolId: string;
  success: boolean;
  error?: string;
  serverId?: string;
  remoteTool?: string;
  pendingAuth?: boolean;  // True if validation was skipped due to pending OAuth2 authentication
}

/**
 * Remove defaulted parameters from the schema's `required` array and annotate
 * each property with a `default` value so MCP clients see them as optional.
 */
export function applyDefaultsToSchema(schema: any, defaults: Record<string, any>): void {
  const defaultKeys = Object.keys(defaults);
  if (defaultKeys.length === 0) return;
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((r: string) => !defaultKeys.includes(r));
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
  args: Record<string, any>
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
export function buildToolSignature(tool: Pick<MCPTool, 'name' | 'inputSchema'>): string {
  const schema: any = tool.inputSchema;
  const properties = schema && typeof schema === 'object' ? schema.properties : undefined;
  if (!properties || typeof properties !== 'object') {
    return `${tool.name}()`;
  }
  const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
  const requiredSet = new Set<string>(requiredList);
  const allProps = Object.keys(properties);

  // Required first (in `required` order, filtering out missing entries),
  // then everything else (in declaration order), marked optional.
  const reqPart = requiredList.filter((name) => name in properties);
  const optPart = allProps.filter((name) => !requiredSet.has(name)).map((name) => `${name}?`);
  return `${tool.name}(${[...reqPart, ...optPart].join(', ')})`;
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
  toolSignatures: string[]
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
      'Tools are listed as `name(required, optional?)`. ' +
      'Invoke with `call_tool`; if you pass wrong/missing args, the full input schema is returned in the error.',
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
  schemaCtx?: { tool: Pick<MCPTool, 'name' | 'inputSchema' | 'description'> }
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
  private toolSchemaCache: Map<string, MCPTool> = new Map();
  private logger = logger.child('MCPHandler');

  constructor(
    db: CapaDatabase,
    sessionManager: SessionManager,
    projectId: string,
    projectPath: string,
    agentId?: string
  ) {
    this.db = db;
    this.sessionManager = sessionManager;
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.agentId = agentId ?? null;
    this.mcpProxy = new MCPProxy(db, projectId, projectPath);

    this.server = new Server(
      {
        name: `capa-${projectId}`,
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
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
      this.logger.warn(`Session ${this.sessionId} expired, creating new session`);
    }
    const session = this.sessionManager.createSession(this.projectId);
    this.sessionId = session.sessionId;
    return session;
  }

  /**
   * Return the set of qualified tool names this endpoint may expose.
   * Returns null for the main agent endpoint (no filtering) or when the
   * sub-agent ID is not found in the current capabilities.
   */
  private getAgentAllowedToolIds(capabilities: Capabilities): Set<string> | null {
    if (!this.agentId || !capabilities.subagents) return null;
    const subAgent = capabilities.subagents.find((a) => a.id === this.agentId);
    if (!subAgent) return null;
    const allowed = new Set<string>();
    for (const toolId of subAgent.tools) {
      const tool = capabilities.tools.find((t) => t.id === toolId);
      if (tool) allowed.add(getQualifiedToolName(tool));
    }
    return allowed;
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const tools: MCPTool[] = [];
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);

      // Determine tool exposure mode (default to 'expose-all')
      const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';

      if (toolExposureMode === 'none') {
        // Project opted out of MCP-driven tool exposure. The agent is
        // expected to discover and run tools via `capa sh` instead. Returning
        // an empty list is the cleanest signal — most clients render this as
        // "no tools available" rather than throwing.
        return { tools: [] };
      }

      if (toolExposureMode === 'expose-all') {
        // Expose-all mode: Show all tools from all skills immediately.
        // Sub-agent endpoints additionally filter to only their declared tools.
        if (capabilities) {
          const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
          const allToolIds = this.sessionManager.getAllRequiredToolsForProject(this.projectId);
          for (const qualifiedName of allToolIds) {
            if (allowedToolIds && !allowedToolIds.has(qualifiedName)) continue;
            const tool = capabilities.tools.find((t) => getQualifiedToolName(t) === qualifiedName);
            if (tool) {
              const mcpTool = await this.convertToolToMCP(tool, capabilities);
              tools.push(mcpTool);
            }
          }
        }
        // Note: setup_tools is NOT included in expose-all mode since all tools are already visible
      } else {
        // On-demand mode: Only expose meta-tools (setup_tools and call_tool)
        tools.push({
          name: 'setup_tools',
          description: 'Activate skills and load their required tools. Should be called when the agent learns (loads) a skill. Returns a compact signature list (`tool_name(required, optional?)`) for every activated tool — full input schemas are returned in the `call_tool` error response when a call is invalid.',
          inputSchema: {
            type: 'object',
            properties: {
              skills: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of skill IDs to activate',
              },
            },
            required: ['skills'],
          },
        });

        tools.push({
          name: 'call_tool',
          description: 'Call any activated tool by name. Use `setup_tools` first to discover available tools (returned as compact signatures). If you pass invalid or missing args the full input schema is returned in the error so you can retry.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the tool to call',
              },
              data: {
                type: 'object',
                description: 'The input data for the tool',
              },
            },
            required: ['name', 'data'],
          },
        });
      }

      return { tools };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
      const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';

      // Handle setup_tools
      if (name === 'setup_tools' && toolExposureMode === 'on-demand') {
        return await this.handleSetupTools(args as { skills: string[] });
      }

      // Handle call_tool in on-demand mode
      if (name === 'call_tool' && toolExposureMode === 'on-demand') {
        return await this.handleCallTool(args as { name: string; data: object });
      }

      // Prevent meta-tools from being called in expose-all mode
      if ((name === 'setup_tools' || name === 'call_tool') && toolExposureMode === 'expose-all') {
        this.logger.warn(`Meta-tool ${name} called in expose-all mode`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `The meta-tool "${name}" is only available in on-demand mode. Your project is configured for expose-all mode.`,
              }),
            },
          ],
        };
      }

      // Handle other tools
      // Only require session for on-demand mode
      if (toolExposureMode === 'on-demand') {
        this.ensureSession();
      }

      // Sub-agent tool access guard: reject calls to tools outside the agent's allowed set
      if (this.agentId) {
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        if (capabilities) {
          const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
          if (allowedToolIds) {
            const normalizedName = normalizeToolName(name);
            const isAllowed = [...allowedToolIds].some(
              (id) => normalizeToolName(id) === normalizedName
            );
            if (!isAllowed) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: `Tool "${name}" is not available on this sub-agent endpoint (${this.agentId}). Use the main capa endpoint to access all tools.`,
                    }),
                  },
                ],
              };
            }
          }
        }
      }

      // Find tool definition
      const toolDef = this.sessionManager.getToolDefinition(this.projectId, name);
      if (!toolDef) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Tool not found: ${name}` }),
            },
          ],
        };
      }

      // Execute tool based on type
      let result: any;
      if (toolDef.type === 'command') {
        const executor = new CommandToolExecutor(this.db, this.projectId, this.projectPath);
        result = await executor.execute(
          name,
          toolDef.def as ToolCommandDefinition,
          args as Record<string, any>
        );
      } else if (toolDef.type === 'mcp') {
        const mcpDef = toolDef.def as ToolMCPDefinition;
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        if (!capabilities) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Project capabilities not found' }),
              },
            ],
          };
        }

        // Find server definition
        const serverId = mcpDef.server.replace('@', '');
        const serverDef = capabilities.servers.find((s) => s.id === serverId);
        if (!serverDef) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Server not found: ${serverId}` }),
              },
            ],
          };
        }

        result = await this.mcpProxy.executeTool(name, mcpDef, serverDef.def, mergeDefaults(mcpDef.defaults, args as Record<string, any>));
      }

      return {
        content: [
          {
            type: 'text',
            text: this.serializeToolResult(result),
          },
        ],
      };
    });
  }

  private async handleSetupTools(args: { skills: string[] }): Promise<any> {
    try {
      this.ensureSession();
      const toolIds = this.sessionManager.setupTools(this.sessionId!, args.skills);
      const signatures = await this.buildToolSignaturesFor(toolIds);
      // `setupTools` updates the session's activeSkills set; read it back so
      // we report the merged list (not just this call's skills) to the agent.
      const activeSkills = this.sessionManager.getSession(this.sessionId!)?.activeSkills ?? args.skills;

      // Send tools/list_changed notification (for backward compatibility)
      await this.server.notification({
        method: 'notifications/tools/list_changed',
        params: {},
      });

      const payload = buildSetupToolsPayload(args.skills, activeSkills, signatures);
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      };
    } catch (error: any) {
      const errorMessage = this.formatSetupToolsError(error);
      // Per the MCP spec, tool execution failures are reported with
      // `isError: true` on the result so the LLM sees the text content —
      // keep `setup_tools` consistent with the `call_tool` error path so
      // clients don't have to special-case the meta-tools.
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  }

  /**
   * Resolve a list of qualified tool names to compact signature strings.
   * Applies the sub-agent allow-list (if any) and skips tools that have no
   * matching definition in the current capabilities snapshot.
   */
  private async buildToolSignaturesFor(toolIds: string[]): Promise<string[]> {
    const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
    if (!capabilities) return [];
    const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
    const signatures: string[] = [];
    for (const qualifiedName of toolIds) {
      if (allowedToolIds && !allowedToolIds.has(qualifiedName)) continue;
      const tool = capabilities.tools.find((t) => getQualifiedToolName(t) === qualifiedName);
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
    const baseMessage = error?.message || 'Failed to setup tools';
    if (typeof baseMessage !== 'string' || !baseMessage.startsWith('Skill not found:')) {
      return baseMessage;
    }
    const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
    if (capabilities && capabilities.skills.length > 0) {
      const availableSkills = capabilities.skills.map((s) => s.id).join(', ');
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
    const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
    if (!capabilities) return null;
    const normalized = normalizeToolName(toolName);
    const tool = capabilities.tools.find(
      (t) => normalizeToolName(getQualifiedToolName(t)) === normalized
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
    options: { includeSchema?: boolean } = {}
  ): Promise<{ content: Array<{ type: string; text: string }>; isError: true }> {
    const includeSchema = options.includeSchema ?? true;
    const mcpTool = includeSchema && toolName ? await this.tryGetToolSchema(toolName) : null;
    const payload = buildCallToolErrorPayload(message, mcpTool ? { tool: mcpTool } : undefined);
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: true,
    };
  }

  private async handleCallTool(args: { name: string; data: object }): Promise<any> {
    const toolName = args.name;
    const toolData = args.data || {};
    try {
      const session = this.ensureSession();
      this.logger.info(`Calling tool via call_tool: ${toolName}`);
      this.logger.debug(`Tool data: ${JSON.stringify(toolData)}`);

      // Find tool definition
      const toolDef = this.sessionManager.getToolDefinition(this.projectId, toolName);
      if (!toolDef) {
        this.logger.warn(`Tool not found: ${toolName}`);
        // No schema attached — by definition we don't have a matching tool.
        return await this.buildCallToolErrorResult(
          toolName,
          `Tool not found: ${toolName}. Make sure you've called setup_tools to activate the required skills.`,
          { includeSchema: false }
        );
      }

      // Check if tool is in available tools for the session (normalize for dot/underscore compat)
      const normalizedToolName = normalizeToolName(toolName);
      if (!session.availableTools.some((t) => normalizeToolName(t) === normalizedToolName)) {
        this.logger.warn(`Tool not activated: ${toolName}`);
        // The tool exists but isn't activated — `setup_tools` is the next
        // step, so don't pre-emptively dump the schema and confuse the agent.
        return await this.buildCallToolErrorResult(
          toolName,
          `Tool "${toolName}" is not activated. Call setup_tools with the appropriate skills first.`,
          { includeSchema: false }
        );
      }

      this.logger.debug(`Tool type: ${toolDef.type}`);

      // Execute tool based on type
      let result: any;
      if (toolDef.type === 'command') {
        this.logger.debug('Executing command tool...');
        const executor = new CommandToolExecutor(this.db, this.projectId, this.projectPath);
        result = await executor.execute(
          toolName,
          toolDef.def as ToolCommandDefinition,
          toolData as Record<string, any>
        );
        this.logger.debug(`Command executed, success: ${result.success}`);
        // Command-tool failures land here as `{success: false, error}` (e.g.
        // "Missing required argument: title") — they don't throw. Route them
        // through the error helper so the agent gets the full schema back and
        // can self-correct on the next call.
        if (result && result.success === false) {
          return await this.buildCallToolErrorResult(
            toolName,
            result.error || 'Command tool failed'
          );
        }
      } else if (toolDef.type === 'mcp') {
        this.logger.debug('Executing MCP tool...');
        const mcpDef = toolDef.def as ToolMCPDefinition;
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        if (!capabilities) {
          this.logger.warn('Project capabilities not found');
          return await this.buildCallToolErrorResult(
            toolName,
            'Project capabilities not found',
            { includeSchema: false }
          );
        }

        // Find server definition
        const serverId = mcpDef.server.replace('@', '');
        const serverDef = capabilities.servers.find((s) => s.id === serverId);
        if (!serverDef) {
          this.logger.warn(`Server not found: ${serverId}`);
          return await this.buildCallToolErrorResult(
            toolName,
            `Server not found: ${serverId}`,
            { includeSchema: false }
          );
        }

        this.logger.debug(`Using MCP server: ${serverId}`);
        result = await this.mcpProxy.executeTool(toolName, mcpDef, serverDef.def, mergeDefaults(mcpDef.defaults, toolData as Record<string, any>));
        this.logger.debug('MCP tool executed');
      }

      return {
        content: [{ type: 'text', text: this.serializeToolResult(result) }],
      };
    } catch (error: any) {
      this.logger.failure(`call_tool execution error: ${error.message}`);
      // Likely an arg/schema problem — attach the schema so the agent can retry.
      return await this.buildCallToolErrorResult(
        toolName,
        error?.message || 'Tool execution failed'
      );
    }
  }

  /**
   * List tools available on a specific MCP server by ID.
   * Returns the raw MCP tool list (name, description, inputSchema).
   */
  async listServerTools(serverId: string, capabilities: Capabilities): Promise<any[]> {
    const serverDef = capabilities.servers.find((s) => s.id === serverId);
    if (!serverDef) return [];
    return await this.mcpProxy.listTools(serverId, serverDef.def);
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
  async getAllShellTools(capabilities: Capabilities): Promise<ShellToolInfo[]> {
    const result: ShellToolInfo[] = [];
    for (const tool of capabilities.tools) {
      if (tool.type === 'mcp') {
        const mcpDef = tool.def as ToolMCPDefinition;
        const serverId = mcpDef.server.replace('@', '');
        const info: ShellToolInfo = {
          id: getQualifiedToolName(tool),
          type: 'mcp',
          description: tool.description || '',
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
        const mcpTool = await this.convertToolToMCP(tool, capabilities);
        const info: ShellToolInfo = {
          id: getQualifiedToolName(tool),
          type: 'command',
          description: mcpTool.description || '',
          inputSchema: mcpTool.inputSchema,
        };
        if (tool.group) {
          info.group = tool.group;
        }
        const def = tool.def as ToolCommandDefinition;
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
  async getShellToolSchema(
    toolId: string,
    capabilities: Capabilities
  ): Promise<{ description: string; inputSchema: any }> {
    const tool = capabilities.tools.find((t) => getQualifiedToolName(t) === toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    if (tool.type === 'command') {
      const mcpTool = await this.convertToolToMCP(tool, capabilities);
      return { description: mcpTool.description || '', inputSchema: mcpTool.inputSchema };
    }

    const mcpDef = tool.def as ToolMCPDefinition;
    const serverId = mcpDef.server.replace('@', '');
    const serverDef = capabilities.servers.find((s) => s.id === serverId);
    if (!serverDef) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const remoteTools = await this.mcpProxy.listTools(serverId, serverDef.def, {
      throwOnError: true,
    });
    const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);
    if (!remoteTool) {
      const available = remoteTools.map((t: any) => t.name).join(', ');
      throw new Error(
        `Tool "${mcpDef.tool}" not found on server "${serverId}". Available tools: ${available || '(none)'}`
      );
    }

    const inputSchema = remoteTool.inputSchema
      ? JSON.parse(JSON.stringify(remoteTool.inputSchema))
      : { type: 'object' as const, properties: {} };
    if (mcpDef.defaults) {
      applyDefaultsToSchema(inputSchema, mcpDef.defaults);
    }

    const description = remoteTool.description || `MCP tool: ${toolId}`;
    // Warm the shared cache so a subsequent tools/call doesn't re-fetch.
    this.toolSchemaCache.set(toolId, { name: toolId, description, inputSchema });

    return { description, inputSchema };
  }

  /**
   * Validate tools and return validation results
   */
  async validateTools(capabilities: Capabilities): Promise<ToolValidationResult[]> {
    const results: ToolValidationResult[] = [];

    for (const tool of capabilities.tools) {
      const qualifiedName = getQualifiedToolName(tool);
      if (tool.type === 'command') {
        results.push({
          toolId: qualifiedName,
          success: true,
        });
      } else {
        const mcpDef = tool.def as ToolMCPDefinition;
        const serverId = mcpDef.server.replace('@', '');
        const serverDef = capabilities.servers.find((s) => s.id === serverId);

        if (!serverDef) {
          results.push({
            toolId: qualifiedName,
            success: false,
            error: `Server not found: ${serverId}`,
            serverId: serverId,
          });
          continue;
        }

        try {
          const remoteTools = await this.mcpProxy.listTools(serverId, serverDef.def);
          const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);

          if (remoteTool) {
            results.push({
              toolId: qualifiedName,
              success: true,
              serverId: serverId,
              remoteTool: mcpDef.tool,
            });
          } else {
            const availableTools = remoteTools.map((t: any) => t.name).join(', ');
            results.push({
              toolId: qualifiedName,
              success: false,
              error: `Tool "${mcpDef.tool}" not found on server "${serverId}". Available tools: ${availableTools || '(none)'}`,
              serverId: serverId,
              remoteTool: mcpDef.tool,
            });
          }
        } catch (error: any) {
          results.push({
            toolId: qualifiedName,
            success: false,
            error: `Failed to connect to server "${serverId}": ${error.message}`,
            serverId: serverId,
            remoteTool: mcpDef.tool,
          });
        }
      }
    }

    return results;
  }

  private async convertToolToMCP(tool: Tool, capabilities: Capabilities): Promise<MCPTool> {
    const qualifiedName = getQualifiedToolName(tool);

    // Check cache first
    if (this.toolSchemaCache.has(qualifiedName)) {
      return this.toolSchemaCache.get(qualifiedName)!;
    }

    if (tool.type === 'command') {
      const def = tool.def as ToolCommandDefinition;
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
          type: 'object' as const,
          properties,
          required,
        },
      };

      this.toolSchemaCache.set(qualifiedName, mcpTool);
      return mcpTool;
    } else {
      // MCP tool - fetch the actual schema from the MCP server
      const mcpDef = tool.def as ToolMCPDefinition;
      const serverId = mcpDef.server.replace('@', '');
      const serverDef = capabilities.servers.find((s) => s.id === serverId);

      if (!serverDef) {
        this.logger.failure(`Server not found for tool ${tool.id}: ${serverId}`);
        const mcpTool: MCPTool = {
          name: qualifiedName,
          description: `MCP tool: ${qualifiedName} (server not found)`,
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        };
        this.toolSchemaCache.set(qualifiedName, mcpTool);
        return mcpTool;
      }

      try {
        const remoteTools = await this.mcpProxy.listTools(serverId, serverDef.def);
        const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);

        if (remoteTool) {
          this.logger.debug(`Fetched schema for ${qualifiedName} from ${serverId}`);
          const inputSchema = remoteTool.inputSchema
            ? JSON.parse(JSON.stringify(remoteTool.inputSchema))
            : { type: 'object' as const, properties: {} };
          if (mcpDef.defaults) {
            applyDefaultsToSchema(inputSchema, mcpDef.defaults);
          }
          const mcpTool: MCPTool = {
            name: qualifiedName,
            description: remoteTool.description || `MCP tool: ${qualifiedName}`,
            inputSchema,
          };
          this.toolSchemaCache.set(qualifiedName, mcpTool);
          return mcpTool;
        } else {
          this.logger.warn(`Tool ${mcpDef.tool} not found on server ${serverId}`);
          const mcpTool: MCPTool = {
            name: qualifiedName,
            description: `MCP tool: ${qualifiedName} (not found on remote server)`,
            inputSchema: {
              type: 'object' as const,
              properties: {},
            },
          };
          this.toolSchemaCache.set(qualifiedName, mcpTool);
          return mcpTool;
        }
      } catch (error: any) {
        this.logger.failure(`Failed to fetch schema for ${qualifiedName}:`, error.message);
        const mcpTool: MCPTool = {
          name: qualifiedName,
          description: `MCP tool: ${qualifiedName}`,
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        };
        this.toolSchemaCache.set(qualifiedName, mcpTool);
        return mcpTool;
      }
    }
  }

  /**
   * Serialize a tool execution result into a text string suitable for an MCP content item.
   *
   * For MCP proxy results — where result.result is an array of upstream content items
   * (each with { type, text }) — this unwraps the array, tries to JSON-parse each item's
   * text, and returns:
   *   - a single item directly (not wrapped in an array) when there is only one entry
   *   - a JSON array of all items when there are multiple entries
   *
   * For command tool results ({success, result/error}) the inner result/error string
   * is returned directly without the wrapper envelope.
   */
  private serializeToolResult(result: any): string {
    const items: any[] = result?.result;

    // Detect MCP proxy result: result.result is a non-empty array of {type, text} objects
    if (
      Array.isArray(items) &&
      items.length > 0 &&
      items.every((i) => i !== null && typeof i === 'object' && 'type' in i && 'text' in i)
    ) {
      const processed = items.map((item) => {
        const raw = typeof item.text === 'string' ? item.text : JSON.stringify(item);
        try {
          return JSON.parse(raw);   // unescape nested JSON strings
        } catch {
          return raw;               // not JSON — return as plain string
        }
      });

      const value = processed.length === 1 ? processed[0] : processed;
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    // Command tool result: unwrap the {success, result/error} envelope
    if (result && typeof result === 'object' && 'success' in result) {
      if (result.success && typeof result.result === 'string') {
        return result.result;
      }
      if (!result.success && typeof result.error === 'string') {
        return result.error;
      }
    }

    return JSON.stringify(result);
  }

  getServer(): Server {
    return this.server;
  }

  /**
   * Handle a JSON-RPC message from HTTP transport
   */
  async handleMessage(message: any): Promise<any> {
    // Handle initialization
    if (message.method === 'initialize') {
      this.logger.info('Initialize request');
      const session = this.ensureSession();
      this.logger.debug(`Session ID: ${this.sessionId}`);

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: `capa-${this.projectId}`,
            version: VERSION,
          },
        },
      };
    }

    // Handle initialized notification
    if (message.method === 'notifications/initialized') {
      this.logger.debug('Initialized notification');
      return {
        jsonrpc: '2.0',
        result: {},
      };
    }

    // Handle tools/list
    if (message.method === 'tools/list') {
      this.logger.info('List tools request');
      const tools: MCPTool[] = [];
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);

      // Determine tool exposure mode (default to 'expose-all')
      const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';
      this.logger.debug(`Tool exposure mode: ${toolExposureMode}`);

      if (toolExposureMode === 'none') {
        // Project opted out of MCP-driven tool exposure. The agent is
        // expected to discover and run tools via `capa sh` instead. Returning
        // an empty list is the cleanest signal — most clients render this as
        // "no tools available" rather than throwing.
        this.logger.info('Tool exposure disabled (none) — returning empty tools list');
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: [] },
        };
      }

      if (toolExposureMode === 'expose-all') {
        // Expose-all mode: Show all tools from all skills immediately.
        // Sub-agent endpoints additionally filter to only their declared tools.
        if (capabilities) {
          const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
          const allToolIds = this.sessionManager.getAllRequiredToolsForProject(this.projectId);
          this.logger.debug(`Exposing ${allowedToolIds ? allowedToolIds.size : allToolIds.length} tool(s) (allowedToolIds=${allowedToolIds ? 'set' : 'null'})`);
          for (const qualifiedName of allToolIds) {
            if (allowedToolIds && !allowedToolIds.has(qualifiedName)) continue;
            const tool = capabilities.tools.find((t) => getQualifiedToolName(t) === qualifiedName);
            if (tool) {
              const mcpTool = await this.convertToolToMCP(tool, capabilities);
              tools.push(mcpTool);
            }
          }
        }
        // Note: setup_tools is NOT included in expose-all mode since all tools are already visible
      } else {
        // On-demand mode: Only expose meta-tools (setup_tools and call_tool)
        tools.push({
          name: 'setup_tools',
          description: 'Activate skills and load their required tools. Should be called when the agent learns (loads) a skill. Returns a compact signature list (`tool_name(required, optional?)`) for every activated tool — full input schemas are returned in the `call_tool` error response when a call is invalid.',
          inputSchema: {
            type: 'object',
            properties: {
              skills: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of skill IDs to activate',
              },
            },
            required: ['skills'],
          },
        });

        tools.push({
          name: 'call_tool',
          description: 'Call any activated tool by name. Use `setup_tools` first to discover available tools (returned as compact signatures). If you pass invalid or missing args the full input schema is returned in the error so you can retry.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the tool to call',
              },
              data: {
                type: 'object',
                description: 'The input data for the tool',
              },
            },
            required: ['name', 'data'],
          },
        });
      }

      this.logger.info(`Returning ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`);
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools,
        },
      };
    }

    // Handle tools/call
    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params;
      this.logger.info(`Call tool: ${name}`);
      this.logger.debug(`Arguments: ${JSON.stringify(args)}`);

      // Handle setup_tools
      if (name === 'setup_tools') {
        try {
          this.ensureSession();

          this.logger.info(`Activating skills: ${args.skills.join(', ')}`);
          const toolIds = this.sessionManager.setupTools(this.sessionId!, args.skills);
          this.logger.success(`Loaded ${toolIds.length} tool(s): ${toolIds.join(', ')}`);

          const signatures = await this.buildToolSignaturesFor(toolIds);
          // `setupTools` updates the session's activeSkills set; read it back so
          // we report the merged list (not just this call's skills) to the agent.
          const activeSkills = this.sessionManager.getSession(this.sessionId!)?.activeSkills ?? args.skills;
          const payload = buildSetupToolsPayload(args.skills, activeSkills, signatures);

          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(payload) }],
            },
          };
        } catch (error: any) {
          this.logger.failure(`Error: ${error.message}`);
          // Mirror the SDK path and the `call_tool` error contract: surface
          // tool-execution failures as `result.isError = true` content rather
          // than a JSON-RPC error so the LLM sees the structured payload (a
          // JSON-RPC error gets eaten by most clients before it reaches the
          // model).
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: this.formatSetupToolsError(error) }),
                },
              ],
              isError: true,
            },
          };
        }
      }

      // Handle call_tool
      if (name === 'call_tool') {
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';

        if (toolExposureMode !== 'on-demand') {
          this.logger.warn('call_tool is only available in on-demand mode');
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: 'call_tool is only available in on-demand mode',
            },
          };
        }

        const toolName = args?.name;
        const toolData = args?.data || {};

        try {
          const session = this.ensureSession();
          this.logger.info(`Calling tool via call_tool: ${toolName}`);
          this.logger.debug(`Tool data: ${JSON.stringify(toolData)}`);

          // Find tool definition
          const toolDef = this.sessionManager.getToolDefinition(this.projectId, toolName);
          if (!toolDef) {
            this.logger.warn(`Tool not found: ${toolName}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: await this.buildCallToolErrorResult(
                toolName,
                `Tool not found: ${toolName}. Make sure you've called setup_tools to activate the required skills.`,
                { includeSchema: false }
              ),
            };
          }

          // Check if tool is in available tools for the session (normalize for dot/underscore compat)
          const normalizedToolName = normalizeToolName(toolName);
          if (!session.availableTools.some((t) => normalizeToolName(t) === normalizedToolName)) {
            this.logger.warn(`Tool not activated: ${toolName}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: await this.buildCallToolErrorResult(
                toolName,
                `Tool "${toolName}" is not activated. Call setup_tools with the appropriate skills first.`,
                { includeSchema: false }
              ),
            };
          }

          this.logger.debug(`Tool type: ${toolDef.type}`);

          // Execute tool based on type
          let result: any;
          if (toolDef.type === 'command') {
            this.logger.debug('Executing command tool...');
            const executor = new CommandToolExecutor(this.db, this.projectId, this.projectPath);
            result = await executor.execute(
              toolName,
              toolDef.def as ToolCommandDefinition,
              toolData as Record<string, any>
            );
            this.logger.debug(`Command executed, success: ${result.success}`);
            // Command-tool failures land here as `{success: false, error}`
            // (e.g. "Missing required argument: title") — they don't throw.
            // Route them through the error helper so the agent gets the full
            // schema back and can self-correct on the next call.
            if (result && result.success === false) {
              return {
                jsonrpc: '2.0',
                id: message.id,
                result: await this.buildCallToolErrorResult(
                  toolName,
                  result.error || 'Command tool failed'
                ),
              };
            }
          } else if (toolDef.type === 'mcp') {
            this.logger.debug('Executing MCP tool...');
            const mcpDef = toolDef.def as ToolMCPDefinition;
            if (!capabilities) {
              this.logger.warn('Project capabilities not found');
              return {
                jsonrpc: '2.0',
                id: message.id,
                result: await this.buildCallToolErrorResult(
                  toolName,
                  'Project capabilities not found',
                  { includeSchema: false }
                ),
              };
            }

            // Find server definition
            const serverId = mcpDef.server.replace('@', '');
            const serverDef = capabilities.servers.find((s) => s.id === serverId);
            if (!serverDef) {
              this.logger.warn(`Server not found: ${serverId}`);
              return {
                jsonrpc: '2.0',
                id: message.id,
                result: await this.buildCallToolErrorResult(
                  toolName,
                  `Server not found: ${serverId}`,
                  { includeSchema: false }
                ),
              };
            }

            this.logger.debug(`Using MCP server: ${serverId}`);
            result = await this.mcpProxy.executeTool(toolName, mcpDef, serverDef.def, mergeDefaults(mcpDef.defaults, toolData as Record<string, any>));
            this.logger.debug('MCP tool executed');
          }

          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: this.serializeToolResult(result),
                },
              ],
            },
          };
        } catch (error: any) {
          this.logger.failure(`call_tool execution error: ${error.message}`);
          // Likely an arg/schema problem — attach the schema so the agent can self-correct.
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: await this.buildCallToolErrorResult(
              toolName,
              error?.message || 'Tool execution failed'
            ),
          };
        }
      }

      // Prevent meta-tools from being called in expose-all mode
      if (name === 'setup_tools' || name === 'call_tool') {
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';
        
        if (toolExposureMode === 'expose-all') {
          this.logger.warn(`Meta-tool ${name} called in expose-all mode`);
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: `The meta-tool "${name}" is only available in on-demand mode. Your project is configured for expose-all mode.`,
            },
          };
        }
      }

      // Handle other tools
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
      const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';

      // Sub-agent tool access guard: reject calls to tools outside the agent's allowed set
      if (this.agentId && capabilities) {
        const allowedToolIds = this.getAgentAllowedToolIds(capabilities);
        if (allowedToolIds) {
          const normalizedName = normalizeToolName(name);
          const isAllowed = [...allowedToolIds].some(
            (id) => normalizeToolName(id) === normalizedName
          );
          if (!isAllowed) {
            this.logger.warn(`Sub-agent "${this.agentId}" attempted to call unauthorized tool: ${name}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: `Tool "${name}" is not available on this sub-agent endpoint (${this.agentId}). Use the main capa endpoint to access all tools.`,
                    }),
                  },
                ],
              },
            };
          }
        }
      }

      // Only require session for on-demand mode
      if (toolExposureMode === 'on-demand') {
        this.ensureSession();
      }

      // Find tool definition
      const toolDef = this.sessionManager.getToolDefinition(this.projectId, name);
      if (!toolDef) {
        this.logger.warn('Tool not found');
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`,
          },
        };
      }

      this.logger.debug(`Tool type: ${toolDef.type}`);

      // Execute tool based on type
      let result: any;
      try {
        if (toolDef.type === 'command') {
          this.logger.debug('Executing command tool...');
          const executor = new CommandToolExecutor(this.db, this.projectId, this.projectPath);
          result = await executor.execute(
            name,
            toolDef.def as ToolCommandDefinition,
            args as Record<string, any>
          );
          this.logger.debug(`Command executed, success: ${result.success}`);
        } else if (toolDef.type === 'mcp') {
          this.logger.debug('Executing MCP tool...');
          const mcpDef = toolDef.def as ToolMCPDefinition;
          const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
          if (!capabilities) {
            this.logger.warn('Project capabilities not found');
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Project capabilities not found',
              },
            };
          }

          // Find server definition
          const serverId = mcpDef.server.replace('@', '');
          const serverDef = capabilities.servers.find((s) => s.id === serverId);
          if (!serverDef) {
            this.logger.warn(`Server not found: ${serverId}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: `Server not found: ${serverId}`,
              },
            };
          }

          this.logger.debug(`Using MCP server: ${serverId}`);
          result = await this.mcpProxy.executeTool(name, mcpDef, serverDef.def, mergeDefaults(mcpDef.defaults, args as Record<string, any>));
          this.logger.debug('MCP tool executed');
        }

        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [
              {
                type: 'text',
                text: this.serializeToolResult(result),
              },
            ],
          },
        };
      } catch (error: any) {
        this.logger.failure(`Tool execution error: ${error.message}`);
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: error.message || 'Tool execution failed',
          },
        };
      }
    }

    // Unknown method
    this.logger.warn(`Unknown method: ${message.method}`);
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32601,
        message: `Method not found: ${message.method}`,
      },
    };
  }

  async close(): Promise<void> {
    await this.mcpProxy.closeAll();
    await this.server.close();
  }
}
