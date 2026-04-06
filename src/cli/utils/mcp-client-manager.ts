import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
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
  /** Get the server key name to use in the config */
  getServerKey: () => string;
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
    getServerKey: () => 'capa',
    getServerConfig: (mcpUrl: string) => ({ url: mcpUrl }),
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    getConfigPath: (projectPath: string) => join(projectPath, '.mcp.json'),
    getServerKey: () => 'capa',
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
      const serverKey = client.getServerKey();
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
 * Register a sub-agent's filtered MCP endpoint with all client configuration files.
 * Uses "capa-{agentId}" as the server key so it appears alongside the main "capa" entry.
 */
export async function registerSubAgentMCPServer(
  projectPath: string,
  agentId: string,
  mcpUrl: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    // Cursor uses .cursor/agents/{id}.md files for sub-agent delegation — it does not
    // use separate MCP server entries per sub-agent. Only the main "capa" entry is
    // registered in .cursor/mcp.json; all tools are accessible from that endpoint.
    if (clientName.toLowerCase() === 'cursor') continue;

    const client = MCP_CLIENTS[clientName.toLowerCase()];
    if (!client) continue;

    try {
      const configPath = client.getConfigPath(projectPath);
      const serverKey = `capa-${agentId}`;

      const configDir = dirname(configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      let config: any = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch {
          config = {};
        }
      }

      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers[serverKey] = { url: mcpUrl };

      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`  ✓ Registered sub-agent "${agentId}" MCP server with ${client.displayName} (key: ${serverKey})`);
    } catch (error) {
      console.error(`  ✗ Failed to register sub-agent MCP server with ${client.displayName}:`, error);
    }
  }
}

/**
 * Unregister a sub-agent's MCP entry ("capa-{agentId}") from all client config files.
 */
export async function unregisterSubAgentMCPServer(
  projectPath: string,
  agentId: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    if (clientName.toLowerCase() === 'cursor') continue;

    const client = MCP_CLIENTS[clientName.toLowerCase()];
    if (!client) continue;

    try {
      const configPath = client.getConfigPath(projectPath);
      const serverKey = `capa-${agentId}`;

      if (!existsSync(configPath)) continue;

      let config: any;
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        continue;
      }

      if (!config.mcpServers?.[serverKey]) continue;

      delete config.mcpServers[serverKey];
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`  ✓ Unregistered sub-agent "${agentId}" MCP server from ${client.displayName}`);
    } catch (error) {
      console.error(`  ✗ Failed to unregister sub-agent MCP server from ${client.displayName}:`, error);
    }
  }
}

/**
 * Remove any stale capa-{agentId} sub-agent entries from a client's MCP config.
 * Used during install to migrate clients (like Cursor) that no longer use per-sub-agent
 * MCP server entries. Preserves the main "capa" entry and any non-capa entries.
 */
export async function purgeCursorSubAgentMCPEntries(projectPath: string): Promise<void> {
  const configPath = join(projectPath, '.cursor', 'mcp.json');
  if (!existsSync(configPath)) return;

  let config: any;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return;
  }

  if (config.mcpServers) {
    const staleKeys = Object.keys(config.mcpServers).filter((k) => k.startsWith('capa-'));
    if (staleKeys.length > 0) {
      for (const key of staleKeys) {
        delete config.mcpServers[key];
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`  ✓ Removed ${staleKeys.length} stale sub-agent MCP entr${staleKeys.length === 1 ? 'y' : 'ies'} from .cursor/mcp.json`);
    }
  }

  // Remove stale .cursor/rules/*.mdc files from old capa versions that used rules
  // instead of the correct .cursor/agents/*.md format
  const rulesDir = join(projectPath, '.cursor', 'rules');
  if (existsSync(rulesDir)) {
    const staleRules = readdirSync(rulesDir).filter((f) => f.endsWith('.mdc'));
    for (const file of staleRules) {
      unlinkSync(join(rulesDir, file));
    }
    if (staleRules.length > 0) {
      console.log(`  ✓ Removed ${staleRules.length} stale .cursor/rules/*.mdc file(s)`);
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
      const serverKey = client.getServerKey();
      
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
