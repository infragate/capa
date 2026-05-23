import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getProvider, getAllProviders } from '../../shared/providers';
import { readTomlFile, writeTomlFile, setNestedKey, deleteNestedKey } from '../../shared/toml-io';
import { getMcpConfigPath, buildMcpEntry } from '../../shared/providers/handlers';
import { taskLog } from '../ui';

interface McpServerEntry {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

type McpJsonConfig = Record<string, unknown>;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function parseJsonConfig(raw: string): McpJsonConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function getServerMap(config: McpJsonConfig, serversKey: string): Record<string, McpServerEntry> {
  const existing = config[serversKey];
  if (!isPlainObject(existing)) {
    config[serversKey] = {};
  }
  return config[serversKey] as Record<string, McpServerEntry>;
}

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
        let config: McpJsonConfig = {};
        if (existsSync(configPath)) {
          const parsed = parseJsonConfig(readFileSync(configPath, 'utf-8'));
          if (parsed === null) {
            console.warn(`  ⚠ Failed to parse existing ${provider.displayName} config, creating new one`);
          } else {
            config = parsed;
          }
        }
        const servers = getServerMap(config, mcp.serversKey);
        servers[mcp.serverKey] = buildMcpEntry(mcp, mcpUrl) as McpServerEntry;
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        setNestedKey(config, [mcp.serversKey, mcp.serverKey], buildMcpEntry(mcp, mcpUrl));
        writeTomlFile(configPath, config);
      }

      taskLog(`  ✓ Registered MCP server with ${provider.displayName}`);
      taskLog(`    Config: ${configPath}`);
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
        let config: McpJsonConfig = {};
        if (existsSync(configPath)) {
          config = parseJsonConfig(readFileSync(configPath, 'utf-8')) ?? {};
        }
        const servers = getServerMap(config, mcp.serversKey);
        servers[serverKey] = buildMcpEntry(mcp, mcpUrl) as McpServerEntry;
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        setNestedKey(config, [mcp.serversKey, serverKey], buildMcpEntry(mcp, mcpUrl));
        writeTomlFile(configPath, config);
      }

      taskLog(`  ✓ Registered sub-agent "${agentId}" MCP server with ${provider.displayName} (key: ${serverKey})`);
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
        const config = parseJsonConfig(readFileSync(configPath, 'utf-8'));
        if (config === null) continue;
        const servers = config[mcp.serversKey];
        if (!isPlainObject(servers) || !(serverKey in servers)) continue;
        delete (servers as Record<string, McpServerEntry>)[serverKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        if (!deleteNestedKey(config, [mcp.serversKey, serverKey])) continue;
        writeTomlFile(configPath, config);
      }

      taskLog(`  ✓ Unregistered sub-agent "${agentId}" MCP server from ${provider.displayName}`);
    } catch (error) {
      console.error(`  ✗ Failed to unregister sub-agent MCP server from ${provider.displayName}:`, error);
    }
  }
}

/**
 * Remove stale capa-{agentId} sub-agent entries from MCP configs for providers
 * that opt in via `purgeStaleSubAgentMcp`.
 */
export async function purgeCursorSubAgentMCPEntries(projectPath: string): Promise<void> {
  for (const provider of getAllProviders()) {
    if (!provider.purgeStaleSubAgentMcp || !provider.mcp) continue;

    const configPath = join(projectPath, provider.mcp.configPath);
    if (!existsSync(configPath)) continue;

    const config = parseJsonConfig(readFileSync(configPath, 'utf-8'));
    if (config === null) continue;

    const serversObj = config[provider.mcp.serversKey];
    if (!isPlainObject(serversObj)) continue;

    const servers = serversObj as Record<string, McpServerEntry>;
    const staleKeys = Object.keys(servers).filter((k) => k.startsWith('capa-'));
    if (staleKeys.length === 0) continue;

    for (const key of staleKeys) {
      delete servers[key];
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    taskLog(
      `  ✓ Removed ${staleKeys.length} stale sub-agent MCP entr${staleKeys.length === 1 ? 'y' : 'ies'} from ${provider.mcp.configPath}`
    );
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
        taskLog(`  - No ${provider.displayName} config found (already removed)`);
        continue;
      }

      if (mcp.format === 'json') {
        const config = parseJsonConfig(readFileSync(configPath, 'utf-8'));
        if (config === null) {
          console.warn(`  ⚠ Failed to parse ${provider.displayName} config, skipping removal`);
          continue;
        }
        const servers = config[mcp.serversKey];
        if (!isPlainObject(servers) || !(mcp.serverKey in servers)) {
          taskLog(`  - MCP server not registered with ${provider.displayName} (already removed)`);
          continue;
        }
        delete (servers as Record<string, McpServerEntry>)[mcp.serverKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        if (!deleteNestedKey(config, [mcp.serversKey, mcp.serverKey])) {
          taskLog(`  - MCP server not registered with ${provider.displayName} (already removed)`);
          continue;
        }
        writeTomlFile(configPath, config);
      }

      taskLog(`  ✓ Unregistered MCP server from ${provider.displayName}`);
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
