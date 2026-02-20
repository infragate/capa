import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Configuration for different MCP clients
 */
interface MCPClientConfig {
  name: string;
  displayName: string;
  /**
   * Get the config file path
   * @param projectPath - Project root path for project-level configs
   */
  getConfigPath: (projectPath: string) => string;
  /**
   * Get the server key name to use in the config
   * @param projectId - The project ID
   */
  getServerKey: (projectId: string) => string;
  /**
   * Get the server configuration object
   * @param mcpUrl - The MCP server URL
   */
  getServerConfig: (mcpUrl: string) => any;
}

/**
 * Supported MCP clients
 */
const MCP_CLIENTS: Record<string, MCPClientConfig> = {
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    getConfigPath: (projectPath: string) => join(projectPath, '.cursor', 'mcp.json'),
    getServerKey: (projectId: string) => `capa-${projectId}`,
    getServerConfig: (mcpUrl: string) => ({ url: mcpUrl }),
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    getConfigPath: (projectPath: string) => join(projectPath, '.mcp.json'),
    getServerKey: (projectId: string) => `capa-${projectId}`,
    getServerConfig: (mcpUrl: string) => ({ url: mcpUrl }),
  },
};

/**
 * Register MCP server with client configuration files
 */
export async function registerMCPServer(
  projectPath: string,
  projectId: string,
  mcpUrl: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    const client = MCP_CLIENTS[clientName.toLowerCase()];
    
    if (!client) {
      console.warn(`  ⚠ Unknown MCP client: ${clientName} (skipping MCP registration)`);
      continue;
    }
    
    try {
      const configPath = client.getConfigPath(projectPath);
      const serverKey = client.getServerKey(projectId);
      const serverConfig = client.getServerConfig(mcpUrl);
      
      // Ensure directory exists
      const configDir = dirname(configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      
      // Read existing config or create new one
      let config: any = {};
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8');
          config = JSON.parse(content);
        } catch (error) {
          console.warn(`  ⚠ Failed to parse existing ${client.displayName} config, creating new one`);
          config = {};
        }
      }
      
      // Ensure mcpServers object exists
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      
      // Add or update our server
      config.mcpServers[serverKey] = serverConfig;
      
      // Write config back
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      console.log(`  ✓ Registered MCP server with ${client.displayName}`);
      console.log(`    Config: ${configPath}`);
    } catch (error) {
      console.error(`  ✗ Failed to register MCP server with ${client.displayName}:`, error);
    }
  }
}

/**
 * Unregister MCP server from client configuration files
 */
export async function unregisterMCPServer(
  projectPath: string,
  projectId: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    const client = MCP_CLIENTS[clientName.toLowerCase()];
    
    if (!client) {
      continue;
    }
    
    try {
      const configPath = client.getConfigPath(projectPath);
      const serverKey = client.getServerKey(projectId);
      
      // Check if config exists
      if (!existsSync(configPath)) {
        console.log(`  - No ${client.displayName} config found (already removed)`);
        continue;
      }
      
      // Read existing config
      let config: any;
      try {
        const content = readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
      } catch (error) {
        console.warn(`  ⚠ Failed to parse ${client.displayName} config, skipping removal`);
        continue;
      }
      
      // Check if our server is registered
      if (!config.mcpServers || !config.mcpServers[serverKey]) {
        console.log(`  - MCP server not registered with ${client.displayName} (already removed)`);
        continue;
      }
      
      // Remove our server
      delete config.mcpServers[serverKey];
      
      // Write config back
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      console.log(`  ✓ Unregistered MCP server from ${client.displayName}`);
    } catch (error) {
      console.error(`  ✗ Failed to unregister MCP server from ${client.displayName}:`, error);
    }
  }
}

/**
 * Get list of supported MCP clients
 */
export function getSupportedMCPClients(): string[] {
  return Object.keys(MCP_CLIENTS);
}

/**
 * Get MCP client display name
 */
export function getMCPClientDisplayName(clientName: string): string | undefined {
  const client = MCP_CLIENTS[clientName.toLowerCase()];
  return client?.displayName;
}
