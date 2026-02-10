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
import { extractAllVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';

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

      // Always include setup_tools
      tools.push({
        name: 'setup_tools',
        description: "Activate skills and load their required tools. Once a skill is activated their tools will be available even if you don't see it - it requires a refresh. If you know about the tool's existence call it.",
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

      // If session has active skills, add their tools
      if (this.sessionId) {
        const session = this.sessionManager.getSession(this.sessionId);
        if (session && session.activeSkills.length > 0) {
          const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
          if (capabilities) {
            for (const toolId of session.availableTools) {
              const tool = capabilities.tools.find((t) => t.id === toolId);
              if (tool) {
                const mcpTool = await this.convertToolToMCP(tool, capabilities);
                tools.push(mcpTool);
              }
            }
          }
        }
      }

      return { tools };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Handle setup_tools
      if (name === 'setup_tools') {
        return await this.handleSetupTools(args as { skills: string[] });
      }

      // Handle other tools
      if (!this.sessionId) {
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

      // Send tools/list_changed notification
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
              message: `Activated ${args.skills.length} skill(s)`,
              skills: args.skills,
              tools: toolIds,
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
        console.error(`      Server not found for tool ${tool.id}: ${serverId}`);
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
          console.log(`      ✓ Fetched schema for ${tool.id} from ${serverId}`);
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
          console.warn(`      ⚠ Tool ${mcpDef.tool} not found on server ${serverId}`);
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
        console.error(`      ✗ Failed to fetch schema for ${tool.id}:`, error.message);
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
      console.log(`    [MCP Handler] Initialize request`);
      // Create session for this connection
      const session = this.sessionManager.createSession(this.projectId);
      this.sessionId = session.sessionId;
      console.log(`      Session ID: ${this.sessionId}`);

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
      console.log(`    [MCP Handler] Initialized notification`);
      return {
        jsonrpc: '2.0',
        result: {},
      };
    }

    // Handle tools/list
    if (message.method === 'tools/list') {
      console.log(`    [MCP Handler] List tools request`);
      const tools: MCPTool[] = [];

      // Always include setup_tools
      tools.push({
        name: 'setup_tools',
        description: 'Activate skills and load their required tools',
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

      // If session has active skills, add their tools
      if (this.sessionId) {
        const session = this.sessionManager.getSession(this.sessionId);
        if (session && session.activeSkills.length > 0) {
          const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
          if (capabilities) {
            for (const toolId of session.availableTools) {
              const tool = capabilities.tools.find((t) => t.id === toolId);
              if (tool) {
                const mcpTool = await this.convertToolToMCP(tool, capabilities);
                tools.push(mcpTool);
              }
            }
          }
        }
      }

      console.log(`      Returning ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`);
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
      console.log(`    [MCP Handler] Call tool: ${name}`);
      console.log(`      Arguments: ${JSON.stringify(args)}`);

      // Handle setup_tools
      if (name === 'setup_tools') {
        try {
          // Create session if needed
          if (!this.sessionId) {
            const session = this.sessionManager.createSession(this.projectId);
            this.sessionId = session.sessionId;
            console.log(`      Created session: ${this.sessionId}`);
          }

          // Setup tools
          console.log(`      Activating skills: ${args.skills.join(', ')}`);
          const toolIds = this.sessionManager.setupTools(this.sessionId, args.skills);
          console.log(`      ✓ Loaded ${toolIds.length} tool(s): ${toolIds.join(', ')}`);

          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Activated ${args.skills.length} skill(s)`,
                    skills: args.skills,
                    tools: toolIds,
                  }),
                },
              ],
            },
          };
        } catch (error: any) {
          console.error(`      ✗ Error: ${error.message}`);
          
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

      // Handle other tools
      if (!this.sessionId) {
        console.log(`      ✗ No active session`);
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
        console.log(`      ✗ Session not found`);
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

      // Find tool definition
      const toolDef = this.sessionManager.getToolDefinition(this.projectId, name);
      if (!toolDef) {
        console.log(`      ✗ Tool not found`);
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`,
          },
        };
      }

      console.log(`      Tool type: ${toolDef.type}`);

      // Execute tool based on type
      let result: any;
      try {
        if (toolDef.type === 'command') {
          console.log(`      Executing command tool...`);
          const executor = new CommandToolExecutor(this.db, this.projectId, this.projectPath);
          result = await executor.execute(
            name,
            toolDef.def as ToolCommandDefinition,
            args as Record<string, any>
          );
          console.log(`      ✓ Command executed, success: ${result.success}`);
        } else if (toolDef.type === 'mcp') {
          console.log(`      Executing MCP tool...`);
          const mcpDef = toolDef.def as ToolMCPDefinition;
          const capabilities = this.sessionManager.getProjectCapabilities(this.projectId);
          if (!capabilities) {
            console.log(`      ✗ Project capabilities not found`);
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
            console.log(`      ✗ Server not found: ${serverId}`);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: `Server not found: ${serverId}`,
              },
            };
          }

          console.log(`      Using MCP server: ${serverId}`);
          result = await this.mcpProxy.executeTool(name, mcpDef, serverDef.def, args as Record<string, any>);
          console.log(`      ✓ MCP tool executed`);
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
        console.error(`      ✗ Tool execution error: ${error.message}`);
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
    console.log(`    [MCP Handler] ✗ Unknown method: ${message.method}`);
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
