import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getProvider, getAllProviders } from '../../shared/providers';
import { readTomlFile, writeTomlFile, setNestedKey, deleteNestedKey } from '../../shared/toml-io';
import { getMcpConfigPath, buildMcpEntry } from '../../shared/providers/handlers';

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
    const provider = getProvider(clientName);

    if (!provider) {
      console.warn(`  ⚠ Unknown provider: ${clientName} (skipping MCP registration)`);
      continue;
    }
    if (!provider.mcp) {
      console.warn(`  ⚠ ${provider.displayName} does not support project-level MCP configuration (skipping)`);
      continue;
    }

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);
      const configDir = dirname(configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      if (mcp.format === 'json') {
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
          } catch {
            console.warn(`  ⚠ Failed to parse existing ${provider.displayName} config, creating new one`);
            config = {};
          }
        }
        if (!config[mcp.serversKey]) {
          config[mcp.serversKey] = {};
        }
        config[mcp.serversKey][mcp.serverKey] = buildMcpEntry(mcp, mcpUrl);
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        setNestedKey(config, [mcp.serversKey, mcp.serverKey], buildMcpEntry(mcp, mcpUrl));
        writeTomlFile(configPath, config);
      }

      console.log(`  ✓ Registered MCP server with ${provider.displayName}`);
      console.log(`    Config: ${configPath}`);
    } catch (error) {
      console.error(`  ✗ Failed to register MCP server with ${provider.displayName}:`, error);
    }
  }
}

/**
 * Register a sub-agent's filtered MCP endpoint with all client configuration files.
 */
export async function registerSubAgentMCPServer(
  projectPath: string,
  agentId: string,
  mcpUrl: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    const provider = getProvider(clientName);
    if (!provider?.mcp) continue;

    // Skip providers that don't use per-sub-agent MCP entries
    if (!provider.mcp.supportsSubAgentEntries) continue;

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);
      const serverKey = `capa-${agentId}`;
      const configDir = dirname(configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      if (mcp.format === 'json') {
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
          } catch {
            config = {};
          }
        }
        if (!config[mcp.serversKey]) config[mcp.serversKey] = {};
        config[mcp.serversKey][serverKey] = buildMcpEntry(mcp, mcpUrl);
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        setNestedKey(config, [mcp.serversKey, serverKey], buildMcpEntry(mcp, mcpUrl));
        writeTomlFile(configPath, config);
      }

      console.log(`  ✓ Registered sub-agent "${agentId}" MCP server with ${provider.displayName} (key: ${serverKey})`);
    } catch (error) {
      console.error(`  ✗ Failed to register sub-agent MCP server with ${provider.displayName}:`, error);
    }
  }
}

/**
 * Unregister a sub-agent's MCP entry from all client config files.
 */
export async function unregisterSubAgentMCPServer(
  projectPath: string,
  agentId: string,
  clients: string[]
): Promise<void> {
  for (const clientName of clients) {
    const provider = getProvider(clientName);
    if (!provider?.mcp) continue;
    if (!provider.mcp.supportsSubAgentEntries) continue;

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);
      const serverKey = `capa-${agentId}`;

      if (!existsSync(configPath)) continue;

      if (mcp.format === 'json') {
        let config: any;
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch {
          continue;
        }
        if (!config[mcp.serversKey]?.[serverKey]) continue;
        delete config[mcp.serversKey][serverKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        if (!deleteNestedKey(config, [mcp.serversKey, serverKey])) continue;
        writeTomlFile(configPath, config);
      }

      console.log(`  ✓ Unregistered sub-agent "${agentId}" MCP server from ${provider.displayName}`);
    } catch (error) {
      console.error(`  ✗ Failed to unregister sub-agent MCP server from ${provider.displayName}:`, error);
    }
  }
}

/**
 * Remove stale capa-{agentId} sub-agent entries from Cursor's MCP config.
 * Cursor does not use per-sub-agent MCP server entries; capa no longer writes them.
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
    const provider = getProvider(clientName);

    if (!provider?.mcp) {
      continue;
    }

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);

      if (!existsSync(configPath)) {
        console.log(`  - No ${provider.displayName} config found (already removed)`);
        continue;
      }

      if (mcp.format === 'json') {
        let config: any;
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch {
          console.warn(`  ⚠ Failed to parse ${provider.displayName} config, skipping removal`);
          continue;
        }
        if (!config[mcp.serversKey] || !config[mcp.serversKey][mcp.serverKey]) {
          console.log(`  - MCP server not registered with ${provider.displayName} (already removed)`);
          continue;
        }
        delete config[mcp.serversKey][mcp.serverKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        if (!deleteNestedKey(config, [mcp.serversKey, mcp.serverKey])) {
          console.log(`  - MCP server not registered with ${provider.displayName} (already removed)`);
          continue;
        }
        writeTomlFile(configPath, config);
      }

      console.log(`  ✓ Unregistered MCP server from ${provider.displayName}`);
    } catch (error) {
      console.error(`  ✗ Failed to unregister MCP server from ${provider.displayName}:`, error);
    }
  }
}

/**
 * Get list of supported MCP clients (those with full MCP integration)
 */
export function getSupportedMCPClients(): string[] {
  return getAllProviders()
    .filter((p) => p.mcp !== undefined)
    .map((p) => p.id);
}

/**
 * Get MCP client display name
 */
export function getMCPClientDisplayName(clientName: string): string | undefined {
  return getProvider(clientName)?.displayName;
}
