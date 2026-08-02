/**
 * Upsert arbitrary upstream MCP server entries into provider-native configs.
 * Unlike registerMCPServer (which always writes the capa proxy URL under key
 * `capa`), these helpers write real command/url entries under the server's id.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getProvider } from '../../../shared/providers';
import { readTomlFile, writeTomlFile, setNestedKey } from '../../../shared/toml-io';
import { getMcpConfigPath } from '../../../shared/providers/handlers';
import type { MCPServerDefinition } from '../../../types/capabilities';
import type { McpIntegration } from '../../../types/providers';

type McpJsonConfig = Record<string, unknown>;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function tryReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function parseJsonConfig(raw: string): McpJsonConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function getServerMap(config: McpJsonConfig, serversKey: string): Record<string, unknown> {
  const existing = config[serversKey];
  if (!isPlainObject(existing)) {
    config[serversKey] = {};
  }
  return config[serversKey] as Record<string, unknown>;
}

/**
 * Build a provider-native MCP entry from a capa MCPServerDefinition.
 */
export function buildNativeMcpEntry(
  mcp: McpIntegration,
  def: MCPServerDefinition,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (def.url) {
    if (mcp.entryType) entry.type = mcp.entryType;
    entry[mcp.entryUrlKey] = def.url;
    if (def.headers && Object.keys(def.headers).length > 0) {
      entry.headers = { ...def.headers };
    }
    if (mcp.entryExtraFields) Object.assign(entry, mcp.entryExtraFields);
    return entry;
  }

  if (def.cmd) {
    // Stdio servers: most providers use `command` + `args` (+ optional `env`/`cwd`).
    // Do not set entryType (that's for HTTP transport discriminators).
    entry.command = def.cmd;
    if (def.args && def.args.length > 0) entry.args = [...def.args];
    if (def.env && Object.keys(def.env).length > 0) entry.env = { ...def.env };
    if (def.cwd) entry.cwd = def.cwd;
    return entry;
  }

  throw new Error('MCP server definition requires either def.url or def.cmd');
}

export interface UpsertNativeMcpResult {
  written: Array<{ provider: string; configPath: string; serverKey: string }>;
  warnings: string[];
}

/**
 * Upsert a native MCP server entry for each provider. Never uses key `capa`.
 */
export async function upsertNativeMcpServer(
  projectPath: string,
  serverKey: string,
  def: MCPServerDefinition,
  providers: string[],
): Promise<UpsertNativeMcpResult> {
  if (serverKey === 'capa' || serverKey.startsWith('capa-')) {
    throw new Error(
      `Refusing to write passthrough MCP entry under reserved key "${serverKey}". Choose a different --id.`,
    );
  }

  const written: UpsertNativeMcpResult['written'] = [];
  const warnings: string[] = [];

  for (const clientName of providers) {
    const provider = getProvider(clientName);
    if (!provider) {
      warnings.push(`Unknown provider: ${clientName} (skipping MCP registration)`);
      continue;
    }
    if (!provider.mcp) {
      warnings.push(
        `${provider.displayName} does not support project-level MCP configuration (skipping)`,
      );
      continue;
    }

    try {
      const { mcp } = provider;
      const configPath = getMcpConfigPath(provider, projectPath);
      const configDir = dirname(configPath);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      const entry = buildNativeMcpEntry(mcp, def);

      if (mcp.format === 'json') {
        let config: McpJsonConfig = {};
        const existing = tryReadFile(configPath);
        if (existing !== null) {
          const parsed = parseJsonConfig(existing);
          if (parsed === null) {
            throw new Error(
              `Failed to parse existing MCP config at ${configPath}. ` +
                `Fix the JSON (or remove the file) and retry — refusing to overwrite invalid config.`,
            );
          }
          config = parsed;
        }
        const servers = getServerMap(config, mcp.serversKey);
        servers[serverKey] = entry;
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      } else if (mcp.format === 'toml') {
        const config = readTomlFile(configPath);
        setNestedKey(config, [mcp.serversKey, serverKey], entry);
        writeTomlFile(configPath, config);
      }

      written.push({ provider: provider.id, configPath, serverKey });
    } catch (error) {
      warnings.push(
        `Failed to write MCP server "${serverKey}" for ${clientName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { written, warnings };
}
