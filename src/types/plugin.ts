// Plugin types: capabilities reference, unified manifest, source attribution

export type PluginProvider = 'cursor' | 'claude';

/**
 * Per-server configuration for a plugin entry in capabilities.yaml.
 * Keyed by the server name in the plugin manifest's `mcpServers` section.
 *
 * Only `as` is supported — to expose specific tools from a plugin server, declare
 * them explicitly in the top-level `tools` section referencing the (renamed) server.
 */
export interface PluginServerConfig {
  /**
   * Stable capa server id. Defaults to the manifest's server key when omitted.
   * Use this to rename a plugin server or resolve collisions with other servers.
   */
  as?: string;
}

/**
 * Plugin reference in the capabilities file.
 *
 * Examples:
 *   { id: 'slack-plugin', type: 'github', def: { repo: 'slackapi/slack-mcp-plugin' } }
 *   { id: 'frontend-design', type: 'github', def: { repo: 'anthropics/claude-plugins-official::plugins/frontend-design' } }
 *   { id: 'code-review', type: 'github', def: { repo: 'anthropics/claude-code@code-review' } }
 *   { id: 'devops', type: 'gitlab', def: { repo: 'acme/platform/team/services/devops-skills', version: '1.0.1' } }
 */
export interface Plugin {
  /** Stable identifier. Defaults to last segment of subpath or repo. */
  id?: string;
  type: 'github' | 'gitlab';
  def: PluginDefinition;
  /** Per-server aliasing and tool subset, keyed by the manifest's mcpServers key. */
  servers?: Record<string, PluginServerConfig>;
}

export interface PluginDefinition {
  /**
   * Repository reference. Three accepted shapes (mirrors skills):
   *   - `owner/repo`               — plugin at the repo root
   *   - `owner/repo@plugin-name`   — recursive search; capa walks the cloned
   *     snapshot for any directory containing `.claude-plugin/plugin.json` or
   *     `.cursor-plugin/plugin.json` whose containing-directory basename or
   *     manifest `name` field equals `plugin-name`. Single segment, no slashes.
   *   - `owner/repo::sub/path`     — exact subpath inside the repo
   *
   * GitLab nested groups are supported (`group/subgroup/project[...]`).
   */
  repo: string;
  /**
   * Optional exact subpath inside the repo when you prefer to keep it out of
   * the `repo` string. Equivalent to writing `owner/repo::<subpath>` — capa
   * rejects definitions that set both this field AND a `::` / `@` suffix in
   * `repo`. Mostly kept around for back-compat with hand-edited capabilities
   * files; new entries should put the path directly in `repo`.
   */
  subpath?: string;
  /** Tag or branch to checkout. */
  version?: string;
  /** Commit SHA to pin to. */
  ref?: string;
  /** Human-readable description (surfaces in `capa list` and docs). */
  description?: string;
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
  /**
   * IDs of skills that this plugin's manifest exposes. Used to validate
   * `type: plugin` skill references in the user's capabilities file.
   */
  skills?: string[];
  /**
   * Capa server IDs (after `as` rename, falling back to the manifest key)
   * that this plugin contributed. Used to detect plugins whose servers
   * are never referenced by user-declared tools.
   */
  serverIds?: string[];
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
