import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getProvider, getAllProviders } from '../../shared/providers';
import { readTomlFile, writeTomlFile, setNestedKey, deleteNestedKey } from '../../shared/toml-io';
import { getMcpConfigPath, buildMcpEntry } from '../../shared/providers/handlers';
import { isPlainObject } from '../../shared/plugin-manifest/types-helpers';
import { readTextOrNull } from '../../shared/fs-utils';
import type { McpIntegration } from '../../types/providers';
import { taskLog } from '../ui';

interface McpServerEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

type McpJsonConfig = Record<string, unknown>;

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

function isCapaSubAgentMcpEntry(
  entry: unknown,
  mcp: McpIntegration,
  agentId: string,
  projectId?: string,
): boolean {
  if (!isPlainObject(entry)) return false;
  const rawUrl = entry[mcp.entryUrlKey];
  if (typeof rawUrl !== 'string') return false;

  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      segments.length === 4 &&
      (!projectId || segments[0] === projectId) &&
      segments.at(-3) === 'agents' &&
      segments.at(-2) === agentId &&
      segments.at(-1) === 'mcp'
    );
  } catch {
    return false;
  }
}

/**
 * Apply the provider's optional sub-agent scope-fence at the top level of
 * the MCP config. For OpenCode this writes
 *   { permission: { 'capa-*_*': 'deny' } }
 * so per-sub-agent MCP entries don't leak into the primary session. No-op
 * for providers without `subAgentScopeFence`. Idempotent.
 */
function applySubAgentScopeFence(config: McpJsonConfig, mcp: McpIntegration): void {
  const fence = mcp.subAgentScopeFence;
  if (!fence) return;
  const existing = config[fence.key];
  const block: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  block[fence.pattern] = fence.value;
  config[fence.key] = block;
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
        const existing = readTextOrNull(configPath);
        if (existing !== null) {
          const parsed = parseJsonConfig(existing);
          if (parsed === null) {
            console.warn(`  ⚠ Failed to parse existing ${provider.displayName} config, creating new one`);
          } else {
            config = parsed;
          }
        }
        const servers = getServerMap(config, mcp.serversKey);
        servers[mcp.serverKey] = buildMcpEntry(mcp, mcpUrl) as McpServerEntry;
        applySubAgentScopeFence(config, mcp);
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
        const existing = readTextOrNull(configPath);
        if (existing !== null) {
          config = parseJsonConfig(existing) ?? {};
        }
        const servers = getServerMap(config, mcp.serversKey);
        servers[serverKey] = buildMcpEntry(mcp, mcpUrl) as McpServerEntry;
        applySubAgentScopeFence(config, mcp);
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
  clients: string[],
  projectId?: string,
): Promise<void> {
  for (const clientName of clients) {
    const provider = getProvider(clientName);
    if (!provider?.mcp) continue;
    if (!provider.mcp.supportsSubAgentEntries) continue;

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);
      const serverKey = `capa-${agentId}`;

      if (mcp.format === 'json') {
        const existing = readTextOrNull(configPath);
        if (existing === null) continue;
        const config = parseJsonConfig(existing);
        if (config === null) continue;
        const servers = config[mcp.serversKey];
        if (!isPlainObject(servers) || !(serverKey in servers)) continue;
        if (!isCapaSubAgentMcpEntry(servers[serverKey], mcp, agentId, projectId)) {
          taskLog(
            `  - Preserved ${provider.displayName} MCP entry "${serverKey}" ` +
              '(not recognizably Capa-owned)',
          );
          continue;
        }
        delete (servers as Record<string, McpServerEntry>)[serverKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        const servers = config[mcp.serversKey];
        const entry = isPlainObject(servers) ? servers[serverKey] : undefined;
        if (
          entry !== undefined &&
          !isCapaSubAgentMcpEntry(entry, mcp, agentId, projectId)
        ) {
          taskLog(
            `  - Preserved ${provider.displayName} MCP entry "${serverKey}" ` +
              '(not recognizably Capa-owned)',
          );
          continue;
        }
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
export async function purgeCursorSubAgentMCPEntries(
  projectPath: string,
  projectId?: string,
): Promise<void> {
  for (const provider of getAllProviders()) {
    if (!provider.purgeStaleSubAgentMcp || !provider.mcp) continue;

    const configPath = join(projectPath, provider.mcp.configPath);
    const existing = readTextOrNull(configPath);
    if (existing === null) continue;

    const config = parseJsonConfig(existing);
    if (config === null) continue;

    const serversObj = config[provider.mcp.serversKey];
    if (!isPlainObject(serversObj)) continue;

    const mcp = provider.mcp;
    const servers = serversObj as Record<string, McpServerEntry>;
    const staleKeys = Object.keys(servers).filter((key) => {
      if (!key.startsWith('capa-')) return false;
      return isCapaSubAgentMcpEntry(servers[key], mcp, key.slice(5), projectId);
    });
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

      if (mcp.format === 'json') {
        const existing = readTextOrNull(configPath);
        if (existing === null) {
          taskLog(`  - No ${provider.displayName} config found (already removed)`);
          continue;
        }
        const config = parseJsonConfig(existing);
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
        const tomlRaw = readTextOrNull(configPath);
        if (tomlRaw === null) {
          taskLog(`  - No ${provider.displayName} config found (already removed)`);
          continue;
        }
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
