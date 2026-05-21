import { getProvider } from '../providers';
import type { UnifiedPluginManifest } from '../../types/plugin';
import {
  isPlainObject,
  parseSkillsField,
  parseSkillsRaw,
} from './types-helpers';
import { parseMcpServers } from './mcp-parser';

/**
 * Cursor's CLI registers `http://localhost:8787/callback` as its OAuth2 loopback
 * redirect URI. When capa picks a plugin's cursor manifest (because a claude
 * variant either doesn't exist or isn't a preferred provider) the .cursor-mcp.json
 * embeds the OAuth `client_id` of Cursor's registered app but omits the callback
 * port — Cursor itself uses the `cursor://anysphere.cursor-mcp/oauth/callback`
 * custom scheme which capa, being a CLI, cannot receive. Defaulting to the
 * Cursor CLI's loopback lets capa impersonate the CLI for the same client_id.
 */
export const CURSOR_CLI_CALLBACK_PORT = 8787;

/**
 * For each MCP server with embedded oauth2 + client_id but no callback_port,
 * inject the Cursor CLI's loopback port. Done in-place on the parsed map.
 */
function applyCursorCliLoopback(mcpServers: ReturnType<typeof parseMcpServers>): void {
  for (const def of Object.values(mcpServers)) {
    if (!def.oauth2 || typeof def.oauth2 !== 'object') continue;
    const o = def.oauth2 as Record<string, unknown>;
    const hasClientId =
      typeof o.client_id === 'string' ||
      typeof o.clientId === 'string' ||
      typeof o.CLIENT_ID === 'string';
    const hasCallbackPort =
      (typeof o.callback_port === 'number' && o.callback_port > 0) ||
      (typeof o.callbackPort === 'number' && (o.callbackPort as number) > 0) ||
      (typeof o.CALLBACK_PORT === 'number' && (o.CALLBACK_PORT as number) > 0);
    if (hasClientId && !hasCallbackPort) {
      o.callback_port = CURSOR_CLI_CALLBACK_PORT;
    }
  }
}

export function parseCursorManifest(
  repoRoot: string,
  data: unknown,
  manifestDir: string = '.cursor-plugin',
): UnifiedPluginManifest {
  const record = isPlainObject(data) ? data : {};
  const name = typeof record.name === 'string' ? record.name : 'unknown';
  const skills = parseSkillsField(repoRoot, parseSkillsRaw(record.skills), 'skills');
  const fallback = getProvider('cursor')?.mcp?.defaultMcpFallbackPath;
  const mcpServers = parseMcpServers(repoRoot, data, fallback, manifestDir);
  applyCursorCliLoopback(mcpServers);

  return {
    name,
    version: typeof record.version === 'string' ? record.version : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    provider: 'cursor',
    skillEntries: skills,
    mcpServers,
  };
}
