import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CapaDatabase } from '../db/database';
import type { MCPServerDefinition, ToolMCPDefinition } from '../types/capabilities';
import { SubprocessManager } from './subprocess-manager';
import { resolveVariablesInObject, hasUnresolvedVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';

export interface MCPToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class MCPProxy {
  private db: CapaDatabase;
  private projectId: string;
  private projectPath: string;
  private subprocessManager: SubprocessManager;
  private clients = new Map<string, Client>();

  constructor(db: CapaDatabase, projectId: string, projectPath: string, subprocessManager: SubprocessManager) {
    this.db = db;
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.subprocessManager = subprocessManager;
  }

  /**
   * Execute a tool on a remote/child MCP server
   */
  async executeTool(
    toolId: string,
    definition: ToolMCPDefinition,
    serverDefinition: MCPServerDefinition,
    args: Record<string, any>
  ): Promise<MCPToolResult> {
    console.log(`        [MCPProxy] Executing tool: ${toolId} on server: ${definition.server}`);
    console.log(`          Tool name: ${definition.tool}`);
    console.log(`          Args: ${JSON.stringify(args)}`);
    
    // Resolve variables in server definition
    const resolvedServerDef = resolveVariablesInObject(
      serverDefinition,
      this.projectId,
      this.db
    );

    // Check for unresolved variables
    if (hasUnresolvedVariables(resolvedServerDef)) {
      console.error(`          ✗ Unresolved variables in server configuration`);
      return {
        success: false,
        error: 'Server configuration has unresolved variables. Please configure credentials.',
      };
    }

    // Get or create MCP client
    const client = await this.getOrCreateClient(definition.server, resolvedServerDef);

    if (!client) {
      console.error(`          ✗ Failed to get client`);
      return {
        success: false,
        error: `Failed to connect to MCP server: ${definition.server}`,
      };
    }

    try {
      console.log(`          Calling tool on MCP server...`);
      // Call the tool
      const result = await client.callTool({
        name: definition.tool,
        arguments: args,
      });

      console.log(`          ✓ Tool call succeeded`);
      return {
        success: true,
        result: result.content,
      };
    } catch (error: any) {
      console.error(`          ✗ Tool call failed: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Tool execution failed',
      };
    }
  }

  /**
   * List tools available on an MCP server
   */
  async listTools(serverId: string, serverDefinition: MCPServerDefinition): Promise<any[]> {
    const resolvedServerDef = resolveVariablesInObject(
      serverDefinition,
      this.projectId,
      this.db
    );

    const client = await this.getOrCreateClient(serverId, resolvedServerDef);
    if (!client) {
      return [];
    }

    try {
      const result = await client.listTools();
      return result.tools;
    } catch (error) {
      console.error(`Failed to list tools from ${serverId}:`, error);
      return [];
    }
  }

  private async getOrCreateClient(
    serverId: string,
    serverDefinition: MCPServerDefinition
  ): Promise<Client | null> {
    // Check if client already exists
    const existing = this.clients.get(serverId);
    if (existing) {
      console.log(`          Using existing MCP client for server: ${serverId}`);
      return existing;
    }

    console.log(`          Creating new MCP client for server: ${serverId}`);

    // For local subprocess-based servers
    if (serverDefinition.cmd) {
      return await this.createStdioClient(serverId, serverDefinition);
    }

    // For remote HTTP-based servers
    if (serverDefinition.url) {
      // TODO: Implement HTTP client for remote MCP servers
      console.warn('          Remote HTTP MCP servers not yet implemented');
      return null;
    }

    return null;
  }

  private async createStdioClient(
    serverId: string,
    serverDefinition: MCPServerDefinition
  ): Promise<Client | null> {
    try {
      console.log(`          Creating stdio client for: ${serverId}`);
      console.log(`            Command: ${serverDefinition.cmd}`);
      console.log(`            Args: ${JSON.stringify(serverDefinition.args || [])}`);
      
      // Get or create subprocess
      const subprocess = await this.subprocessManager.getOrCreateSubprocess(
        serverId,
        serverDefinition,
        this.projectPath
      );

      if (subprocess.status !== 'running' || !subprocess.process) {
        console.error(`            ✗ Subprocess ${serverId} is not running (status: ${subprocess.status})`);
        return null;
      }

      console.log(`            Subprocess running with PID: ${subprocess.process.pid}`);

      // Create stdio transport
      const transport = new StdioClientTransport({
        command: serverDefinition.cmd!,
        args: serverDefinition.args || [],
        env: serverDefinition.env,
      });

      // Create client
      const client = new Client(
        {
          name: `capa-proxy-${serverId}`,
          version: VERSION,
        },
        {
          capabilities: {},
        }
      );

      console.log(`            Connecting client...`);
      await client.connect(transport);

      this.clients.set(serverId, client);
      console.log(`            ✓ Client connected`);
      return client;
    } catch (error) {
      console.error(`            ✗ Failed to create MCP client for ${serverId}:`, error);
      return null;
    }
  }

  /**
   * Close all clients
   */
  async closeAll(): Promise<void> {
    for (const [serverId, client] of this.clients) {
      try {
        await client.close();
      } catch (error) {
        console.error(`Error closing client ${serverId}:`, error);
      }
    }
    this.clients.clear();
  }
}
