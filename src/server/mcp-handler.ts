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

export class CapaMCPServer {
  private server: Server;
  private db: CapaDatabase;
  private sessionManager: SessionManager;
  private subprocessManager: SubprocessManager;
  private projectId: string;
  private projectPath: string;
  private sessionId: string | null = null;

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

    this.server = new Server(
      {
        name: `capa-${projectId}`,
        version: '1.0.0',
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
                tools.push(this.convertToolToMCP(tool));
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

        const proxy = new MCPProxy(this.db, this.projectId, this.subprocessManager);
        result = await proxy.executeTool(name, mcpDef, serverDef.def, args as Record<string, any>);
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message || 'Failed to setup tools',
            }),
          },
        ],
      };
    }
  }

  private convertToolToMCP(tool: Tool): MCPTool {
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

      return {
        name: tool.id,
        description: `Command tool: ${tool.id}`,
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
      };
    } else {
      // MCP tool - we'll use a generic schema
      return {
        name: tool.id,
        description: `MCP tool: ${tool.id}`,
        inputSchema: {
          type: 'object',
          properties: {},
        },
      };
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
            version: '1.0.0',
          },
        },
      };
    }

    // Handle initialized notification
    if (message.method === 'initialized') {
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
                tools.push(this.convertToolToMCP(tool));
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
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error.message || 'Failed to setup tools',
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
          const proxy = new MCPProxy(this.db, this.projectId, this.subprocessManager);
          result = await proxy.executeTool(name, mcpDef, serverDef.def, args as Record<string, any>);
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
