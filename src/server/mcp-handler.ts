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
import { SessionManager } from './session-manager';
import { CommandToolExecutor } from './tool-executor';
import { MCPProxy } from './mcp-proxy';
import { SubprocessManager } from './subprocess-manager';
import { VERSION } from '../version';
import { logger } from '../shared/logger';

export interface ToolValidationResult {
  toolId: string;
  success: boolean;
  error?: string;
  serverId?: string;
  remoteTool?: string;
  pendingAuth?: boolean;  // True if validation was skipped due to pending OAuth2 authentication
}

export class CapaMCPServer {
  private server: Server;
  private db: CapaDatabase;
  private sessionManager: SessionManager;
  private subprocessManager: SubprocessManager;
  private mcpProxy: MCPProxy;
  private projectId: string;
  private projectPath: string;
  private sessionId: string | null = null;
  private toolSchemaCache: Map<string, MCPTool> = new Map();
  private logger = logger.child('MCPHandler');

  constructor(
    db: CapaDatabase,
    sessionManager: SessionManager,
    subprocessManager: SubprocessManager,
    projectId: string,
    projectPath: string
  ) {
    this.db = db;
    this.sessionManager = sessionManager;
    this.subprocessManager = subprocessManager;
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.mcpProxy = new MCPProxy(db, projectId, projectPath, subprocessManager);

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

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const tools: MCPTool[] = [];
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);

      // Determine tool exposure mode (default to 'expose-all')
      const toolExposureMode = capabilities?.options?.toolExposure || 'expose-all';

      if (toolExposureMode === 'expose-all') {
        // Expose-all mode: Show all tools from all skills immediately
        if (capabilities) {
          const allToolIds = this.sessionManager.getAllRequiredToolsForProject(this.projectId);
          for (const toolId of allToolIds) {
            const tool = capabilities.tools.find((t) => t.id === toolId);
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
          description: 'Activate skills and load their required tools. This tool should always be called when the agent learns (loads) a skill. Returns the full list of available tools with their schemas for your reference.',
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
          description: 'Call any activated tool by name. Use setup_tools first to see available tools and their schemas.',
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
        if (!this.sessionId) {
          this.logger.warn('No active session');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'No active session. Call setup_tools first.',
                }),
              },
            ],
          };
        }

        const session = this.sessionManager.getSession(this.sessionId);
        if (!session) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Session not found' }),
              },
            ],
          };
        }

        // Update activity
        this.sessionManager.updateActivity(this.sessionId);
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

        result = await this.mcpProxy.executeTool(name, mcpDef, serverDef.def, args as Record<string, any>);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    });
  }

  private async handleSetupTools(args: { skills: string[] }): Promise<any> {
    try {
      // Create session if needed
      if (!this.sessionId) {
        const session = this.sessionManager.createSession(this.projectId);
        this.sessionId = session.sessionId;
      }

      // Setup tools
      const toolIds = this.sessionManager.setupTools(this.sessionId, args.skills);

      // Get capabilities to fetch tool schemas
      const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
      const toolSchemas: MCPTool[] = [];

      if (capabilities) {
        // Fetch full schemas for all activated tools
        for (const toolId of toolIds) {
          const tool = capabilities.tools.find((t) => t.id === toolId);
          if (tool) {
            const mcpTool = await this.convertToolToMCP(tool, capabilities);
            toolSchemas.push(mcpTool);
          }
        }
      }

      // Send tools/list_changed notification (for backward compatibility)
      await this.server.notification({
        method: 'notifications/tools/list_changed',
        params: {},
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Activated ${args.skills.length} skill(s) with ${toolIds.length} tool(s)`,
              skills: args.skills,
              tools: toolSchemas,
            }),
          },
        ],
      };
    } catch (error: any) {
      // If skill not found, include list of available skills
      let errorMessage = error.message || 'Failed to setup tools';
      if (error.message && error.message.startsWith('Skill not found:')) {
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        if (capabilities && capabilities.skills.length > 0) {
          const availableSkills = capabilities.skills.map(s => s.id).join(', ');
          errorMessage = `${error.message}. Available skills: ${availableSkills}`;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: errorMessage,
            }),
          },
        ],
      };
    }
  }

  private async handleCallTool(args: { name: string; data: object }): Promise<any> {
    try {
      // Validate session exists
      if (!this.sessionId) {
        this.logger.warn('No active session');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'No active session. Call setup_tools first.',
              }),
            },
          ],
        };
      }

      const session = this.sessionManager.getSession(this.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Session not found' }),
            },
          ],
        };
      }

      // Extract tool name and data
      const toolName = args.name;
      const toolData = args.data || {};

      this.logger.info(`Calling tool via call_tool: ${toolName}`);
      this.logger.debug(`Tool data: ${JSON.stringify(toolData)}`);

      // Update activity
      this.sessionManager.updateActivity(this.sessionId);

      // Find tool definition
      const toolDef = this.sessionManager.getToolDefinition(this.projectId, toolName);
      if (!toolDef) {
        this.logger.warn(`Tool not found: ${toolName}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Tool not found: ${toolName}. Make sure you've called setup_tools to activate the required skills.`,
              }),
            },
          ],
        };
      }

      // Check if tool is in available tools for the session
      if (!session.availableTools.includes(toolName)) {
        this.logger.warn(`Tool not activated: ${toolName}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Tool "${toolName}" is not activated. Call setup_tools with the appropriate skills first.`,
              }),
            },
          ],
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
      } else if (toolDef.type === 'mcp') {
        this.logger.debug('Executing MCP tool...');
        const mcpDef = toolDef.def as ToolMCPDefinition;
        const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
        if (!capabilities) {
          this.logger.warn('Project capabilities not found');
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
          this.logger.warn(`Server not found: ${serverId}`);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Server not found: ${serverId}` }),
              },
            ],
          };
        }

        this.logger.debug(`Using MCP server: ${serverId}`);
        result = await this.mcpProxy.executeTool(toolName, mcpDef, serverDef.def, toolData as Record<string, any>);
        this.logger.debug('MCP tool executed');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error: any) {
      this.logger.failure(`call_tool execution error: ${error.message}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message || 'Tool execution failed',
            }),
          },
        ],
      };
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
   * Enrich capabilities with tools from plugin MCP servers (servers with sourcePlugin).
   * Lists tools from each plugin server and adds them to capabilities.tools.
   */
  async enrichCapabilitiesWithPluginTools(capabilities: Capabilities): Promise<Capabilities> {
    const pluginTools: Tool[] = [];
    for (const server of capabilities.servers) {
      if (!server.sourcePlugin || !server.def.cmd) continue;
      try {
        const remoteTools = await this.mcpProxy.listTools(server.id, server.def);
        for (const t of remoteTools) {
          const name = typeof t.name === 'string' ? t.name : '';
          if (!name) continue;
          const toolId = `${server.id}-${name}`;
          pluginTools.push({
            id: toolId,
            type: 'mcp',
            def: { server: `@${server.id}`, tool: name },
            sourcePlugin: server.sourcePlugin,
          });
        }
      } catch {
        // Skip failed plugin servers
      }
    }
    if (pluginTools.length === 0) return capabilities;
    return {
      ...capabilities,
      tools: [...capabilities.tools, ...pluginTools],
    };
  }

  /**
   * Validate tools and return validation results
   */
  async validateTools(capabilities: Capabilities): Promise<ToolValidationResult[]> {
    const results: ToolValidationResult[] = [];

    for (const tool of capabilities.tools) {
      if (tool.type === 'command') {
        // Command tools are always valid if they have proper structure
        results.push({
          toolId: tool.id,
          success: true,
        });
      } else {
        // MCP tool - validate against remote server
        const mcpDef = tool.def as ToolMCPDefinition;
        const serverId = mcpDef.server.replace('@', '');
        const serverDef = capabilities.servers.find((s) => s.id === serverId);

        if (!serverDef) {
          results.push({
            toolId: tool.id,
            success: false,
            error: `Server not found: ${serverId}`,
            serverId: serverId,
          });
          continue;
        }

        try {
          // Use the shared MCP proxy instance to list tools
          const remoteTools = await this.mcpProxy.listTools(serverId, serverDef.def);

          // Find the matching tool on the remote server
          const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);

          if (remoteTool) {
            results.push({
              toolId: tool.id,
              success: true,
              serverId: serverId,
              remoteTool: mcpDef.tool,
            });
          } else {
            // Get list of available tools for better error message
            const availableTools = remoteTools.map((t: any) => t.name).join(', ');
            results.push({
              toolId: tool.id,
              success: false,
              error: `Tool "${mcpDef.tool}" not found on server "${serverId}". Available tools: ${availableTools || '(none)'}`,
              serverId: serverId,
              remoteTool: mcpDef.tool,
            });
          }
        } catch (error: any) {
          results.push({
            toolId: tool.id,
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
    // Check cache first
    if (this.toolSchemaCache.has(tool.id)) {
      return this.toolSchemaCache.get(tool.id)!;
    }

    if (tool.type === 'command') {
      const def = tool.def as ToolCommandDefinition;
      const properties: any = {};
      const required: string[] = [];

      if (def.run.args) {
        for (const arg of def.run.args) {
          properties[arg.name] = {
            type: arg.type,
            description: arg.description,
          };
          if (arg.required !== false) {
            required.push(arg.name);
          }
        }
      }

      const mcpTool: MCPTool = {
        name: tool.id,
        description: `Command tool: ${tool.id}`,
        inputSchema: {
          type: 'object' as const,
          properties,
          required,
        },
      };

      // Cache it
      this.toolSchemaCache.set(tool.id, mcpTool);
      return mcpTool;
    } else {
      // MCP tool - fetch the actual schema from the MCP server
      const mcpDef = tool.def as ToolMCPDefinition;
      const serverId = mcpDef.server.replace('@', '');
      const serverDef = capabilities.servers.find((s) => s.id === serverId);

      if (!serverDef) {
        this.logger.failure(`Server not found for tool ${tool.id}: ${serverId}`);
        const mcpTool: MCPTool = {
          name: tool.id,
          description: `MCP tool: ${tool.id} (server not found)`,
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        };
        this.toolSchemaCache.set(tool.id, mcpTool);
        return mcpTool;
      }

      try {
        // Use the shared MCP proxy instance
        const remoteTools = await this.mcpProxy.listTools(serverId, serverDef.def);

        // Find the matching tool on the remote server
        const remoteTool = remoteTools.find((t: any) => t.name === mcpDef.tool);

        if (remoteTool) {
          this.logger.debug(`Fetched schema for ${tool.id} from ${serverId}`);
          const mcpTool: MCPTool = {
            name: tool.id,
            description: remoteTool.description || `MCP tool: ${tool.id}`,
            inputSchema: remoteTool.inputSchema || {
              type: 'object' as const,
              properties: {},
            },
          };
          this.toolSchemaCache.set(tool.id, mcpTool);
          return mcpTool;
        } else {
          this.logger.warn(`Tool ${mcpDef.tool} not found on server ${serverId}`);
          const mcpTool: MCPTool = {
            name: tool.id,
            description: `MCP tool: ${tool.id} (not found on remote server)`,
            inputSchema: {
              type: 'object' as const,
              properties: {},
            },
          };
          this.toolSchemaCache.set(tool.id, mcpTool);
          return mcpTool;
        }
      } catch (error: any) {
        this.logger.failure(`Failed to fetch schema for ${tool.id}:`, error.message);
        const mcpTool: MCPTool = {
          name: tool.id,
          description: `MCP tool: ${tool.id}`,
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        };
        this.toolSchemaCache.set(tool.id, mcpTool);
        return mcpTool;
      }
    }
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
      // Create session for this connection
      const session = this.sessionManager.createSession(this.projectId);
      this.sessionId = session.sessionId;
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

      if (toolExposureMode === 'expose-all') {
        // Expose-all mode: Show all tools from all skills immediately
        if (capabilities) {
          const allToolIds = this.sessionManager.getAllRequiredToolsForProject(this.projectId);
          this.logger.debug(`Exposing all ${allToolIds.length} tool(s) from all skills`);
          for (const toolId of allToolIds) {
            const tool = capabilities.tools.find((t) => t.id === toolId);
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
          description: 'Activate skills and load their required tools. This tool should always be called when the agent learns (loads) a skill. Returns the full list of available tools with their schemas for your reference.',
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
          description: 'Call any activated tool by name. Use setup_tools first to see available tools and their schemas.',
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
          // Create session if needed
          if (!this.sessionId) {
            const session = this.sessionManager.createSession(this.projectId);
            this.sessionId = session.sessionId;
            this.logger.debug(`Created session: ${this.sessionId}`);
          }

          // Setup tools
          this.logger.info(`Activating skills: ${args.skills.join(', ')}`);
          const toolIds = this.sessionManager.setupTools(this.sessionId, args.skills);
          this.logger.success(`Loaded ${toolIds.length} tool(s): ${toolIds.join(', ')}`);

          // Get capabilities to fetch tool schemas
          const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
          const toolSchemas: MCPTool[] = [];

          if (capabilities) {
            // Fetch full schemas for all activated tools
            for (const toolId of toolIds) {
              const tool = capabilities.tools.find((t) => t.id === toolId);
              if (tool) {
                const mcpTool = await this.convertToolToMCP(tool, capabilities);
                toolSchemas.push(mcpTool);
              }
            }
          }

          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Activated ${args.skills.length} skill(s) with ${toolIds.length} tool(s)`,
                    skills: args.skills,
                    tools: toolSchemas,
                  }),
                },
              ],
            },
          };
        } catch (error: any) {
          this.logger.failure(`Error: ${error.message}`);

          // If skill not found, include list of available skills
          let errorMessage = error.message || 'Failed to setup tools';
          if (error.message && error.message.startsWith('Skill not found:')) {
            const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
            if (capabilities && capabilities.skills.length > 0) {
              const availableSkills = capabilities.skills.map(s => s.id).join(', ');
              errorMessage = `${error.message}. Available skills: ${availableSkills}`;
            }
          }

          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: errorMessage,
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

        try {
          // Validate session exists
          if (!this.sessionId) {
            this.logger.warn('No active session');
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'No active session. Call setup_tools first.',
              },
            };
          }

          const session = this.sessionManager.getSession(this.sessionId);
          if (!session) {
            this.logger.warn('Session not found');
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Session not found',
              },
            };
          }

          // Extract tool name and data
          const toolName = args.name;
          const toolData = args.data || {};

          this.logger.info(`Calling tool via call_tool: ${toolName}`);
          this.logger.debug(`Tool data: ${JSON.stringify(toolData)}`);

          // Update activity
          this.sessionManager.updateActivity(this.sessionId);

          // Find tool definition
          const toolDef = this.sessionManager.getToolDefinition(this.projectId, toolName);
          if (!toolDef) {
            this.logger.warn(`Tool not found: ${toolName}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32601,
                message: `Tool not found: ${toolName}. Make sure you've called setup_tools to activate the required skills.`,
              },
            };
          }

          // Check if tool is in available tools for the session
          if (!session.availableTools.includes(toolName)) {
            this.logger.warn(`Tool not activated: ${toolName}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: `Tool "${toolName}" is not activated. Call setup_tools with the appropriate skills first.`,
              },
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
          } else if (toolDef.type === 'mcp') {
            this.logger.debug('Executing MCP tool...');
            const mcpDef = toolDef.def as ToolMCPDefinition;
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
            result = await this.mcpProxy.executeTool(toolName, mcpDef, serverDef.def, toolData as Record<string, any>);
            this.logger.debug('MCP tool executed');
          }

          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
            },
          };
        } catch (error: any) {
          this.logger.failure(`call_tool execution error: ${error.message}`);
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

      // Only require session for on-demand mode
      if (toolExposureMode === 'on-demand') {
        if (!this.sessionId) {
          this.logger.warn('No active session');
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'No active session. Call setup_tools first.',
            },
          };
        }

        const session = this.sessionManager.getSession(this.sessionId);
        if (!session) {
          this.logger.warn('Session not found');
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Session not found',
            },
          };
        }

        // Update activity
        this.sessionManager.updateActivity(this.sessionId);
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
          result = await this.mcpProxy.executeTool(name, mcpDef, serverDef.def, args as Record<string, any>);
          this.logger.debug('MCP tool executed');
        }

        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
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
    await this.server.close();
  }
}
