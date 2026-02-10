import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { CapaDatabase } from '../db/database';
import type { MCPServerDefinition, ToolMCPDefinition } from '../types/capabilities';
import { SubprocessManager } from './subprocess-manager';
import { resolveVariablesInObject, hasUnresolvedVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';
import { OAuth2Manager } from './oauth-manager';

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
  private oauth2Manager: OAuth2Manager;
  private clients = new Map<string, Client>();

  constructor(db: CapaDatabase, projectId: string, projectPath: string, subprocessManager: SubprocessManager) {
    this.db = db;
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.subprocessManager = subprocessManager;
    this.oauth2Manager = new OAuth2Manager(db);
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
      return await this.createHttpClient(serverId, serverDefinition);
    }

    return null;
  }

  private async createHttpClient(
    serverId: string,
    serverDefinition: MCPServerDefinition
  ): Promise<Client | null> {
    try {
      console.log(`          Creating HTTP client for: ${serverId}`);
      console.log(`            URL: ${serverDefinition.url}`);

      // Create HTTP transport with OAuth2 support
      const transport = new HttpMCPTransport(
        serverDefinition.url!,
        this.projectId,
        serverId,
        this.db,
        this.oauth2Manager,
        serverDefinition
      );

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
    } catch (error: any) {
      console.error(`            ✗ Failed to create HTTP client for ${serverId}:`, error);
      return null;
    }
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

/**
 * HTTP Transport for MCP with OAuth2 support
 */
class HttpMCPTransport implements Transport {
  private url: string;
  private projectId: string;
  private serverId: string;
  private db: CapaDatabase;
  private oauth2Manager: OAuth2Manager;
  private serverDefinition: MCPServerDefinition;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    url: string,
    projectId: string,
    serverId: string,
    db: CapaDatabase,
    oauth2Manager: OAuth2Manager,
    serverDefinition: MCPServerDefinition
  ) {
    this.url = url;
    this.projectId = projectId;
    this.serverId = serverId;
    this.db = db;
    this.oauth2Manager = oauth2Manager;
    this.serverDefinition = serverDefinition;
  }

  async start(): Promise<void> {
    // Transport is ready immediately for HTTP
    console.log(`              [HttpTransport] Started for ${this.url}`);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add custom headers from server definition
      if (this.serverDefinition.headers) {
        Object.assign(headers, this.serverDefinition.headers);
      }

      // Add OAuth2 token if available
      if (this.serverDefinition.oauth2) {
        const accessToken = await this.oauth2Manager.getAccessToken(
          this.projectId,
          this.serverId,
          this.serverDefinition.oauth2
        );
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }
      }

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      // Handle 401 Unauthorized - token might be expired
      if (response.status === 401 && this.serverDefinition.oauth2) {
        console.log(`              [HttpTransport] 401 Unauthorized, attempting token refresh`);
        
        // Try to refresh token
        const refreshed = await this.oauth2Manager.refreshAccessToken(
          this.projectId,
          this.serverId,
          this.serverDefinition.oauth2
        );

        if (refreshed) {
          // Retry request with new token
          const newToken = await this.oauth2Manager.getAccessToken(
            this.projectId,
            this.serverId,
            this.serverDefinition.oauth2
          );
          if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`;
            const retryResponse = await fetch(this.url, {
              method: 'POST',
              headers,
              body: JSON.stringify(message),
            });

            if (retryResponse.ok) {
              const responseMessage = await retryResponse.json();
              if (this.onmessage) {
                this.onmessage(responseMessage);
              }
              return;
            }
          }
        }

        // If refresh failed, throw error
        throw new Error('Authentication failed. Please reconnect OAuth2.');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseMessage = await response.json();
      if (this.onmessage) {
        this.onmessage(responseMessage);
      }
    } catch (error: any) {
      console.error(`              [HttpTransport] Error sending message:`, error);
      if (this.onerror) {
        this.onerror(error);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    console.log(`              [HttpTransport] Closed for ${this.url}`);
    if (this.onclose) {
      this.onclose();
    }
  }
}
