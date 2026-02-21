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
import { logger } from '../shared/logger';

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
  private logger = logger.child('MCPProxy');

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
    // Strip @ prefix from server ID if present
    const serverId = definition.server.replace('@', '');
    
    this.logger.info(`Executing tool: ${toolId} on server: ${serverId}`);
    this.logger.debug(`Tool name: ${definition.tool}, Args: ${JSON.stringify(args)}`);
    
    // Resolve variables in server definition
    const resolvedServerDef = resolveVariablesInObject(
      serverDefinition,
      this.projectId,
      this.db
    );

    // Check for unresolved variables
    if (hasUnresolvedVariables(resolvedServerDef)) {
      this.logger.failure('Unresolved variables in server configuration');
      return {
        success: false,
        error: 'Server configuration has unresolved variables. Please configure credentials.',
      };
    }

    // Get or create MCP client
    const client = await this.getOrCreateClient(serverId, resolvedServerDef);

    if (!client) {
      this.logger.failure('Failed to get client');
      return {
        success: false,
        error: `Failed to connect to MCP server: ${serverId}`,
      };
    }

    try {
      this.logger.debug('Calling tool on MCP server...');
      // Call the tool
      const result = await client.callTool({
        name: definition.tool,
        arguments: args,
      });

      this.logger.success('Tool call succeeded');
      return {
        success: true,
        result: result.content,
      };
    } catch (error: any) {
      this.logger.failure(`Tool call failed: ${error.message}`);
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
    // Strip @ prefix from server ID if present
    const cleanServerId = serverId.replace('@', '');
    
    const resolvedServerDef = resolveVariablesInObject(
      serverDefinition,
      this.projectId,
      this.db
    );

    const client = await this.getOrCreateClient(cleanServerId, resolvedServerDef);
    if (!client) {
      return [];
    }

    try {
      const result = await client.listTools();
      return result.tools;
    } catch (error) {
      this.logger.error(`Failed to list tools from ${cleanServerId}:`, error);
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
      this.logger.debug(`Using existing MCP client for server: ${serverId}`);
      return existing;
    }

    this.logger.info(`Creating new MCP client for server: ${serverId}`);

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
      // Skip connecting to OAuth2 servers until the user has connected (avoids 401 during install/validation)
      if (serverDefinition.oauth2 && !this.oauth2Manager.isServerConnected(this.projectId, serverId)) {
        this.logger.debug(`Skipping HTTP client for ${serverId} (OAuth2 required, not connected)`);
        return null;
      }

      this.logger.info(`Creating HTTP client for: ${serverId}`);
      this.logger.debug(`URL: ${serverDefinition.url}`);

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

      this.logger.debug('Connecting client...');
      await client.connect(transport);

      this.clients.set(serverId, client);
      this.logger.success('Client connected');
      return client;
    } catch (error: any) {
      this.logger.failure(`Failed to create HTTP client for ${serverId}:`, error);
      return null;
    }
  }

  private async createStdioClient(
    serverId: string,
    serverDefinition: MCPServerDefinition
  ): Promise<Client | null> {
    try {
      this.logger.info(`Creating stdio client for: ${serverId}`);
      this.logger.debug(`Command: ${serverDefinition.cmd}, Args: ${JSON.stringify(serverDefinition.args || [])}`);
      
      // Get or create subprocess
      const subprocess = await this.subprocessManager.getOrCreateSubprocess(
        serverId,
        serverDefinition,
        this.projectPath
      );

      if (subprocess.status !== 'running' || !subprocess.process) {
        this.logger.failure(`Subprocess ${serverId} is not running (status: ${subprocess.status})`);
        return null;
      }

      this.logger.debug(`Subprocess running with PID: ${subprocess.process.pid}`);

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

      this.logger.debug('Connecting client...');
      await client.connect(transport);

      this.clients.set(serverId, client);
      this.logger.success('Client connected');
      return client;
    } catch (error) {
      this.logger.failure(`Failed to create MCP client for ${serverId}:`, error);
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
        this.logger.error(`Error closing client ${serverId}:`, error);
      }
    }
    this.clients.clear();
  }
}

/**
 * Parse Server-Sent Events (SSE) format response
 * Format: "event: message\ndata: {...}\n\n"
 */
function parseSSEResponse(text: string): JSONRPCMessage | null {
  const lines = text.trim().split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.substring(6).trim();
      try {
        return JSON.parse(jsonStr);
      } catch (error) {
        logger.error(`Failed to parse SSE data: ${jsonStr}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * HTTP Transport for MCP with OAuth2 support and session management
 */
class HttpMCPTransport implements Transport {
  private url: string;
  private projectId: string;
  private serverId: string;
  private db: CapaDatabase;
  private oauth2Manager: OAuth2Manager;
  private serverDefinition: MCPServerDefinition;
  private logger = logger.child('HttpTransport');
  public sessionId?: string;
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
    this.logger.debug(`Started for ${this.url}`);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      this.logger.debug(`Sending message: ${JSON.stringify(message)}`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };

      // Add session ID if we have one (for Atlassian and other session-based servers)
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
      }

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

      const tlsOptions = this.serverDefinition.tlsSkipVerify
        ? ({ tls: { rejectUnauthorized: false } } as object)
        : {};

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        ...tlsOptions,
      } as RequestInit);

      // Handle 401 Unauthorized - token might be expired
      if (response.status === 401 && this.serverDefinition.oauth2) {
        this.logger.warn('401 Unauthorized, attempting token refresh');
        
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
              ...tlsOptions,
            } as RequestInit);

            if (retryResponse.ok) {
              // Extract session ID from retry response
              const sessionId = retryResponse.headers.get('mcp-session-id');
              if (sessionId && !this.sessionId) {
                this.sessionId = sessionId;
                this.logger.info(`Session established: ${sessionId}`);
              }

              // Check content type to determine response format
              const contentType = retryResponse.headers.get('content-type') || '';
              let responseMessage: JSONRPCMessage;

              if (contentType.includes('text/event-stream')) {
                // Parse SSE format
                const text = await retryResponse.text();
                const parsed = parseSSEResponse(text);
                if (!parsed) {
                  throw new Error('Failed to parse SSE response');
                }
                responseMessage = parsed;
              } else {
                // Parse regular JSON
                responseMessage = await retryResponse.json();
              }

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
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const errorJson = await response.json();
            errorDetails = `: ${JSON.stringify(errorJson)}`;
          } else {
            const errorText = await response.text();
            errorDetails = errorText ? `: ${errorText}` : '';
          }
        } catch (e) {
          // Ignore parsing errors
        }
        this.logger.error(`HTTP ${response.status}: ${response.statusText}${errorDetails}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorDetails}`);
      }

      // Extract session ID from response headers (for session-based servers like Atlassian)
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId && !this.sessionId) {
        this.sessionId = sessionId;
        this.logger.info(`Session established: ${sessionId}`);
      }

      // Check content type to determine response format
      const contentType = response.headers.get('content-type') || '';
      let responseMessage: JSONRPCMessage;

      if (contentType.includes('text/event-stream')) {
        // Parse SSE format
        const text = await response.text();
        const parsed = parseSSEResponse(text);
        if (!parsed) {
          throw new Error('Failed to parse SSE response');
        }
        responseMessage = parsed;
      } else {
        // Parse regular JSON
        responseMessage = await response.json();
      }

      if (this.onmessage) {
        this.onmessage(responseMessage);
      }
    } catch (error: any) {
      this.logger.error('Error sending message:', error);
      if (this.onerror) {
        this.onerror(error);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.logger.debug(`Closed for ${this.url}`);
    if (this.onclose) {
      this.onclose();
    }
  }
}
