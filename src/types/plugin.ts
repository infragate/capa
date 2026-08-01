// Plugin types: capabilities reference, unified manifest, source attribution

/**
 * @see ProviderIntegration.pluginProviderId — registry id may differ from this manifest id
 * (e.g. registry id `claude-code` maps to manifest id `claude`).
 */
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
 * Attribution for capabilities that came from a plugin
 * (skills, servers, tools, rules, hooks, subagents).
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
  /** Sub-agent IDs contributed by this plugin. */
  subagentIds?: string[];
  /** Hook IDs contributed by this plugin. */
  hookIds?: string[];
  /** Rule IDs contributed by this plugin. */
  ruleIds?: string[];
}

/**
 * One skill entry in the unified plugin manifest (path relative to plugin root).
 */
export interface UnifiedSkillEntry {
  id: string;
  relativePath: string;
}

/**
 * Legacy flat command (slash-command markdown) to convert into a skill tree.
 */
export interface UnifiedCommandEntry {
  id: string;
  /** Path to the `.md` file relative to the plugin root. */
  relativePath: string;
}

/**
 * Plugin agent markdown, mapped toward a capa `SubAgent`.
 */
export interface UnifiedAgentEntry {
  id: string;
  relativePath: string;
  description?: string;
  /** Body after frontmatter — becomes `SubAgent.instructions`. */
  instructions: string;
  /** Skill ids listed in agent frontmatter that exist in this plugin. */
  skillIds: string[];
  /** Frontmatter keys beyond name/description/skills that were not mapped. */
  droppedFrontmatterKeys: string[];
}

/**
 * One hook action from a provider plugin manifest's hooks file.
 * Paths may still contain `${CLAUDE_PLUGIN_ROOT}` or `./…` until merge time.
 */
export interface UnifiedHookEntry {
  /** Stable hint used to build `plugin-<installId>-…` ids at merge. */
  idHint: string;
  /** Native provider event name (e.g. `PreToolUse`, `sessionStart`). */
  event: string;
  type: 'command' | 'prompt';
  command?: string;
  prompt?: string;
  matcher?: string;
  timeout?: number;
  failClosed?: boolean;
  sequential?: boolean;
  /**
   * Capa provider this hook was declared for (`claude-code` from a Claude
   * manifest, `cursor` from a Cursor manifest). Dual-manifest plugins can
   * contribute both.
   */
  targetProvider?: 'claude-code' | 'cursor';
}

/**
 * Cursor (or compatible) rule file from the plugin.
 */
export interface UnifiedRuleEntry {
  id: string;
  relativePath: string;
  /** Rule body (frontmatter stripped). */
  content: string;
  description?: string;
  appliesTo?: string[];
  alwaysApply?: boolean;
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
  /** Legacy flat commands; materialised as skills at merge time. */
  commandEntries?: UnifiedCommandEntry[];
  agentEntries?: UnifiedAgentEntry[];
  hookEntries?: UnifiedHookEntry[];
  ruleEntries?: UnifiedRuleEntry[];
  mcpServers: Record<string, NormalizedPluginMCPServerDef>;
  /**
   * Artifact kinds present in the plugin tree that capa does not install
   * (e.g. `lsp`, `monitors`, `themes`). Surfaced as install warnings.
   */
  skippedArtifacts?: string[];
}
