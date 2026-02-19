// Plugin types: capabilities reference, unified manifest, source attribution

export type PluginProvider = 'cursor' | 'claude';

/**
 * Plugin reference in the capabilities file (remote only for now).
 */
export interface Plugin {
  id?: string; // Optional stable id; derived from name + ref if absent
  type: 'remote';
  def: PluginDefinition;
}

export interface PluginDefinition {
  /** URI: github:owner/repo, github:owner/repo:v1.0.0, github:owner/repo#sha (gitlab:... supported) */
  uri: string;
  version?: string;
  ref?: string;
}

/**
 * Attribution for capabilities that came from a plugin (skills, servers, tools).
 */
export interface SourcePlugin {
  id: string;   // Stable plugin id (e.g. slug + short ref)
  name: string; // Plugin display name from manifest
  provider: PluginProvider;
}

/**
 * Resolved plugin metadata for display (name, version, provider, repo link).
 */
export interface ResolvedPluginInfo {
  id: string;
  name: string;
  version?: string;
  provider: PluginProvider;
  repository: string; // e.g. https://github.com/owner/repo
}

/**
 * One skill entry in the unified plugin manifest (path relative to plugin root).
 */
export interface UnifiedSkillEntry {
  id: string;
  relativePath: string;
}

/**
 * Normalized MCP server def for plugin. Either subprocess (cmd) or remote (url).
 * Matches capa MCPServerDefinition: cmd/args/env for subprocess, url/headers/oauth2 for remote.
 */
export interface NormalizedPluginMCPServerDef {
  /** Subprocess: command to run */
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Remote: HTTP MCP server URL */
  url?: string;
  headers?: Record<string, string>;
  /** OAuth config (Claude uses "oauth", capa uses oauth2) */
  oauth2?: unknown;
}

/**
 * Unified plugin manifest after parsing a provider manifest (Cursor or Claude).
 */
export interface UnifiedPluginManifest {
  name: string;
  version?: string;
  description?: string;
  provider: PluginProvider;
  skillEntries: UnifiedSkillEntry[];
  mcpServers: Record<string, NormalizedPluginMCPServerDef>;
}
