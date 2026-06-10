import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { HiddenStdioClientTransport as StdioClientTransport } from './stdio-client-transport';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { CapaDatabase } from '../db/database';
import type { MCPServerDefinition, ToolMCPDefinition } from '../types/capabilities';
import type { OAuth2Config } from '../types/oauth';
import { resolveVariablesInObject, hasUnresolvedVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';
import { OAuth2Manager } from './oauth-manager';
import { logger } from '../shared/logger';
import { shouldSkipTlsVerify } from '../shared/tls-skip-verify';

export interface MCPToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

class MCPSessionExpiredError extends Error {
  constructor() {
    super('MCP session expired or not found');
    this.name = 'MCPSessionExpiredError';
  }
}

/**
 * Thrown from `createHttpClient` when an OAuth2-protected server has no
 * active connection. Tolerant callers (install-time validation, default
 * `listTools`) catch this and degrade silently — so a disconnected server
 * doesn't spam 401s. On-demand callers (an explicit `capa sh` tool call,
 * `listTools` with `throwOnError`) rethrow it as a user-facing
 * "Authentication failed" instead of the misleading "Could not connect."
 */
class MCPOAuthDisconnectedError extends Error {
  constructor(public readonly serverId: string) {
    super(`Authentication failed for "${serverId}". Please reconnect OAuth2.`);
    this.name = 'MCPOAuthDisconnectedError';
  }
}

export class MCPProxy {
  private db: CapaDatabase;
  private projectId: string;
  private projectPath: string;
  private oauth2Manager: OAuth2Manager;
  private clients = new Map<string, Client>();
  private logger = logger.child('MCPProxy');

  constructor(db: CapaDatabase, projectId: string, projectPath: string) {
    this.db = db;
    this.projectId = projectId;
    this.projectPath = projectPath;
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
    let client: Client | null;
    try {
      client = await this.getOrCreateClient(serverId, resolvedServerDef);
    } catch (error) {
      if (error instanceof MCPOAuthDisconnectedError) {
        this.logger.failure(error.message);
        return { success: false, error: error.message };
      }
      throw error;
    }

    if (!client) {
      this.logger.failure('Failed to get client');
      return {
        success: false,
        error: `Failed to connect to MCP server: ${serverId}`,
      };
    }

    try {
      this.logger.debug('Calling tool on MCP server...');
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
      if (error instanceof MCPSessionExpiredError) {
        this.logger.warn(`Session expired for ${serverId}, reconnecting and retrying tool call...`);
        this.clients.delete(serverId);
        let freshClient: Client | null;
        try {
          freshClient = await this.getOrCreateClient(serverId, resolvedServerDef);
        } catch (reconnectError) {
          if (reconnectError instanceof MCPOAuthDisconnectedError) {
            return { success: false, error: reconnectError.message };
          }
          throw reconnectError;
        }
        if (!freshClient) {
          return { success: false, error: `Failed to reconnect to MCP server: ${serverId}` };
        }
        try {
          const retryResult = await freshClient.callTool({
            name: definition.tool,
            arguments: args,
          });
          this.logger.success('Tool call succeeded after reconnect');
          return { success: true, result: retryResult.content };
        } catch (retryError: any) {
          this.logger.failure(`Tool call failed after reconnect: ${retryError.message}`);
          return { success: false, error: retryError.message || 'Tool execution failed after reconnect' };
        }
      }
      this.logger.failure(`Tool call failed: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Tool execution failed',
      };
    }
  }

  /**
   * List tools available on an MCP server.
   *
   * By default this is tolerant: connection/listing failures are logged and an
   * empty array is returned so aggregate callers don't blow up on one bad server.
   * Pass `throwOnError: true` (used by on-demand schema resolution) to surface
   * the underlying failure to the caller instead. `timeoutMs` bounds the request
   * so a hung server can't block indefinitely.
   */
  async listTools(
    serverId: string,
    serverDefinition: MCPServerDefinition,
    options: { throwOnError?: boolean; timeoutMs?: number } = {}
  ): Promise<any[]> {
    const { throwOnError = false, timeoutMs = 15000 } = options;
    // Strip @ prefix from server ID if present
    const cleanServerId = serverId.replace('@', '');

    const resolvedServerDef = resolveVariablesInObject(
      serverDefinition,
      this.projectId,
      this.db
    );

    let client: Client | null;
    try {
      client = await this.getOrCreateClient(cleanServerId, resolvedServerDef);
    } catch (error) {
      if (error instanceof MCPOAuthDisconnectedError) {
        if (throwOnError) throw error;
        return [];
      }
      throw error;
    }
    if (!client) {
      if (throwOnError) {
        throw new Error(`Could not connect to MCP server "${cleanServerId}"`);
      }
      return [];
    }

    try {
      const result = await client.listTools(undefined, { timeout: timeoutMs });
      return result.tools;
    } catch (error) {
      if (error instanceof MCPSessionExpiredError) {
        this.logger.warn(`Session expired for ${cleanServerId}, reconnecting...`);
        this.clients.delete(cleanServerId);
        let freshClient: Client | null;
        try {
          freshClient = await this.getOrCreateClient(cleanServerId, resolvedServerDef);
        } catch (reconnectError) {
          if (reconnectError instanceof MCPOAuthDisconnectedError) {
            if (throwOnError) throw reconnectError;
            return [];
          }
          throw reconnectError;
        }
        if (!freshClient) {
          if (throwOnError) {
            throw new Error(`Could not reconnect to MCP server "${cleanServerId}"`);
          }
          return [];
        }
        try {
          const result = await freshClient.listTools(undefined, { timeout: timeoutMs });
          return result.tools;
        } catch (retryError) {
          this.logger.error(`Failed to list tools from ${cleanServerId} after reconnect:`, retryError);
          if (throwOnError) throw retryError;
          return [];
        }
      }
      this.logger.error(`Failed to list tools from ${cleanServerId}:`, error);
      if (throwOnError) throw error;
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
    // Surface OAuth-disconnect as a typed error rather than a bare `null`, so
    // on-demand callers (e.g. `capa sh <tool>`) can show "Authentication
    // failed" instead of the misleading "Could not connect." Tolerant callers
    // catch this and degrade silently, preserving the no-401-during-install
    // behavior that the original early-return guaranteed.
    if (serverDefinition.oauth2 && !this.oauth2Manager.isServerConnected(this.projectId, serverId)) {
      this.logger.debug(`Skipping HTTP client for ${serverId} (OAuth2 required, not connected)`);
      throw new MCPOAuthDisconnectedError(serverId);
    }

    try {
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

      client.onclose = () => {
        this.logger.info(`Client ${serverId} closed, removing from cache`);
        this.clients.delete(serverId);
      };

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

      const transport = new StdioClientTransport({
        command: serverDefinition.cmd!,
        args: serverDefinition.args || [],
        env: { ...process.env, ...serverDefinition.env } as Record<string, string>,
        cwd: serverDefinition.cwd ?? this.projectPath,
      });

      const client = new Client(
        {
          name: `capa-proxy-${serverId}`,
          version: VERSION,
        },
        {
          capabilities: {},
        }
      );

      client.onclose = () => {
        this.logger.info(`Client ${serverId} closed, removing from cache`);
        this.clients.delete(serverId);
      };

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
  private skipTlsVerify: boolean;
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
    this.skipTlsVerify = shouldSkipTlsVerify(
      !!serverDefinition.tlsSkipVerify,
      `MCP HTTP transport (${serverId})`
    );
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
          this.serverDefinition.oauth2 as OAuth2Config
        );
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }
      }

      const tlsOptions = this.skipTlsVerify
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
          this.serverDefinition.oauth2 as OAuth2Config
        );

        if (refreshed) {
          // Retry request with new token
          const newToken = await this.oauth2Manager.getAccessToken(
            this.projectId,
            this.serverId,
            this.serverDefinition.oauth2 as OAuth2Config
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

      // Handle 404 - remote server may have expired our session
      if (response.status === 404 && this.sessionId) {
        this.logger.warn(`404 Not Found with active session ID - session likely expired, clearing session`);
        this.sessionId = undefined;
        throw new MCPSessionExpiredError();
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
