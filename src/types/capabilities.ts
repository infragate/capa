// Capabilities file types

import type { Plugin, SourcePlugin, ResolvedPluginInfo } from './plugin';
import type { Rule } from './rules';
import type { Hook } from './hooks';

/** OAuth2 settings on MCP server definitions (plugin manifest or auto-detected). */
export interface OAuth2Config {
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  redirectUri?: string;
  pkce?: boolean;
  /** Auto-detected / runtime fields */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  resourceServer?: string;
  registrationEndpoint?: string;
  scope?: string;
  client_id?: string;
  callback_port?: number;
  callbackPort?: number;
  oauth?: { clientId?: string; [key: string]: unknown };
}

export type CapabilitiesFormat = 'json' | 'yaml';
export type { Plugin, SourcePlugin, ResolvedPluginInfo } from './plugin';
export type { Rule } from './rules';
export type {
  CanonicalHookEvent,
  Hook,
  HookSource,
  HookSourceDef,
  ProviderScopedEvent,
} from './hooks';

/**
 * Tool exposure modes for MCP clients.
 *
 * - `'expose-all'`: All tools from all skills are exposed immediately via the
 *   MCP `tools/list` response. Largest context footprint; lowest friction.
 * - `'on-demand'`: Only the meta-tools `setup_tools` and `call_tool` are
 *   listed; the agent activates skill-specific tools by calling
 *   `setup_tools(['<skill>'])`. `setup_tools` returns a compact signature
 *   list (`tool_name(required, optional?)`); the full input schema is only
 *   returned in `call_tool` error responses when the agent calls incorrectly.
 * - `'none'`: capa does **not** write any project-local MCP config files
 *   (`.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml` `mcp_servers.capa`,
 *   sub-agent `capa-<id>` entries, etc.) at install time, and the MCP
 *   endpoints return an empty `tools/list`. The agent is expected to
 *   discover and execute tools through the `capa sh` CLI fallback instead.
 */
export type ToolExposureMode = 'expose-all' | 'on-demand' | 'none';

/**
 * Security options for skill installation.
 * Omit a property (or comment it out) to disable that feature. Only present properties are applied.
 */
export interface SecurityOptions {
  /**
   * Block skill installation if any file contains these phrases.
   * Configure inline as string array or via file reference.
   * Omit or comment out to disable.
   */
  blockedPhrases?: string[] | { file: string };
  /**
   * Extra regex character class content for characters to allow BEYOND the hardcoded baseline.
   * The baseline (tab, LF, CR, all printable ASCII U+0020–U+007E) is always preserved, so
   * markdown-critical characters like `-`, `:`, `"`, `'`, and newlines are never stripped.
   * Use this to permit additional Unicode ranges (e.g. `[\\u00A0-\\uFFFF]` for all Unicode).
   * Set to an empty string `""` to apply baseline-only sanitization (strips non-ASCII Unicode).
   * Omit or comment out to disable sanitization entirely.
   */
  allowedCharacters?: string;
}

/**
 * Configuration options for capabilities behavior
 */
export interface CapabilitiesOptions {
  /**
   * Determines how tools are exposed to MCP clients. See `ToolExposureMode`
   * for full semantics of each value.
   * @default 'expose-all'
   */
  toolExposure?: ToolExposureMode;
  /**
   * Security options for skill installation (blocked phrases, character sanitization)
   */
  security?: SecurityOptions;
  /**
   * CLI commands that must be available before `capa install` proceeds.
   * Installation stops immediately if any command is missing.
   */
  requiresCommands?: RequiredCommand[];
}

/**
 * Repository + file definition for github/gitlab agent snippets.
 * Follows the same `repo` string format used by Skill, with two grammars:
 *
 *   - `owner/repo@<basename>`  → recursive search for a file with that
 *     basename anywhere in the repo. Errors on 0 or multiple matches.
 *   - `owner/repo::<path>`     → exact file path inside the repo.
 *
 * Both accept an optional `:version` (tag/branch) or `#sha` suffix.
 *
 * Examples:
 *   "vercel-labs/agent-skills@AGENTS.md"             // search by basename
 *   "vercel-labs/agent-skills::docs/tips.md:v1.2.0"  // exact path, pinned tag
 *   "vercel-labs/agent-skills::AGENTS.md#abc123def"  // exact path, pinned SHA
 */
export interface AgentSnippetDef {
  repo: string;
}

/**
 * A single snippet to append to the agent instructions file (AGENTS.md / CLAUDE.md).
 * Each snippet is wrapped in capa-owned HTML-comment markers so it can be updated or
 * removed without touching content written by the user.
 *
 * Supported types (consistent with Skill):
 *   - inline  : literal content embedded in the capabilities file
 *   - remote  : content fetched from a raw URL at install time
 *   - github  : file fetched from a GitHub repository (see AgentSnippetDef for repo string format)
 *   - gitlab  : file fetched from a GitLab repository (see AgentSnippetDef for repo string format)
 */
export interface AgentSnippet {
  /**
   * Unique identifier used as the capa marker id in the file.
   * Optional for github/gitlab — derived from the filepath if omitted.
   * Required for inline and remote types.
   */
  id?: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab';
  /** Literal markdown text (required when type is 'inline'). */
  content?: string;
  /** Raw URL of a markdown file to fetch (required when type is 'remote'). */
  url?: string;
  /** Repository + file definition (required when type is 'github' or 'gitlab'). */
  def?: AgentSnippetDef;
}

/**
 * Optional base file that seeds the agent instructions file before any snippets are applied.
 * If omitted, capa creates a blank AGENTS.md (or uses the existing one).
 */
/**
 * Source definition for the base agent instructions file.
 * Supports the same source types as snippets (remote, github, gitlab) plus local file.
 *
 * Examples:
 *   ref: https://raw.githubusercontent.com/org/repo/main/AGENTS.md   # remote URL
 *   type: github / def.repo: org/repo::AGENTS.md                      # GitHub file, exact path
 *   type: gitlab / def.repo: group/repo::AGENTS.md:v1.0.0             # GitLab file, exact path, pinned
 *   type: local / path: ./docs/AGENTS-base.md                        # local file (relative to capabilities file)
 */
export interface AgentFileBase {
  /**
   * Source type. Defaults to 'remote' when `ref` is set and `type` is omitted.
   * Use 'github' or 'gitlab' together with `def.repo`, or 'local' with `path`.
   */
  type?: 'remote' | 'github' | 'gitlab' | 'local';
  /** Raw URL — used when type is 'remote' (or when type is omitted and ref is present). */
  ref?: string;
  /** Repository + file definition for github/gitlab types. */
  def?: AgentSnippetDef;
  /**
   * Path to a local markdown file. Used when type is 'local'.
   * Relative paths are resolved from the directory containing the capabilities file.
   */
  path?: string;
}

/**
 * Configuration for the `agents` section in the capabilities file.
 * Controls how capa manages AGENTS.md / CLAUDE.md in the project.
 */
export interface AgentFileConfig {
  /**
   * Optional base file downloaded and written as the starting content of AGENTS.md.
   * Capa tracks this block under the reserved id `__base__` so re-running install
   * refreshes it without overwriting user-added content outside capa markers.
   */
  base?: AgentFileBase;
  /**
   * List of snippets to append to the agent instructions file.
   * Each snippet is idempotently upserted on install and removed on clean.
   */
  additional?: AgentSnippet[];
}

/**
 * A CLI command that must be available on the user's system.
 */
export interface RequiredCommand {
  cli: string;
  description?: string;
}

/**
 * A named sub-agent configuration. On `capa install`:
 * - A **filtered MCP endpoint** is created at `/{projectId}/agents/{id}/mcp` exposing
 *   only this agent's declared tools. Registered in `.mcp.json` as `"capa-{id}"` for
 *   claude-code; Cursor uses per-file delegation instead (see below).
 * - **claude-code**: `.claude/agents/{id}.md` is written (Claude Code sub-agent format)
 *   and a context block is added to `CLAUDE.md`.
 * - **cursor**: `.cursor/agents/{id}.md` is written (Cursor subagent format); Cursor
 *   reads the `description` field to decide when to automatically delegate.
 *
 * Sub-agents reference skill and tool IDs already declared in the top-level
 * `skills` and `tools` arrays — no separate installation is needed.
 */
export interface SubAgent {
  /** Unique identifier. Used as the MCP server key (`capa-{id}`) and agent file name. */
  id: string;
  /**
   * Human-readable description of this agent's role.
   * For Cursor: written into the `description` frontmatter field which drives
   * automatic delegation — make it specific about when to use this agent.
   */
  description?: string;
  /**
   * Skill IDs (from the top-level `skills` array) this agent uses.
   * Listed in the generated agent files for context.
   */
  skills: string[];
  /**
   * Tool IDs (from the top-level `tools` array) this agent may call.
   * Only these tools are exposed on the agent's filtered MCP endpoint.
   */
  tools: string[];
  /**
   * Optional markdown content appended to the agent file body.
   * Use this for role-specific instructions, scope constraints, or rules.
   */
  instructions?: string;
}

export interface Capabilities {
  providers?: string[];
  skills: Skill[];
  servers: MCPServer[];
  tools: Tool[];
  plugins?: Plugin[];
  /** Resolved plugin metadata (name, version, provider, repository) for display */
  resolvedPlugins?: ResolvedPluginInfo[];
  options?: CapabilitiesOptions;
  /** Manages content written to AGENTS.md / CLAUDE.md in the project root. */
  agents?: AgentFileConfig;
  /**
   * Named sub-agent configurations. See `SubAgent` for per-provider install behavior.
   */
  subagents?: SubAgent[];
  /**
   * Rules installed into each provider's rules directory (or folded into the
   * instructions file for providers without a dedicated rules location).
   */
  rules?: Rule[];
  /**
   * Lifecycle hooks installed across providers that support them. For each
   * declared hook capa records the targeted provider config + JSON pointer
   * (or TOML key path) so it can edit shared config files surgically.
   */
  hooks?: Hook[];
}

export interface Skill {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local' | 'installed' | 'plugin';
  def: SkillDefinition;
  sourcePlugin?: SourcePlugin;
}

export interface SkillDefinition {
  description?: string;
  requires?: string[]; // Tool IDs
  // For installed skills: skill exists outside capa; capa only acknowledges it for tool binding.
  // No url, repo, content, or path — capa does not install or fetch.
  // For plugin skills: same as installed but the skill is sourced from a configured plugin.
  // Capa validates that the skill id matches a skill exposed by some plugin's manifest
  // and warns if no match is found.
  // For remote skills (raw SKILL.md URL)
  url?: string;
  // For GitHub skills (e.g., "vercel-labs/agent-skills@find-skills")
  // For GitLab skills (e.g., "group/project@skill-name")
  // Enhanced format: "owner/repo@skill" or "owner/repo@skill:version" or "owner/repo@skill#sha"
  repo?: string;
  // For inline skills (SKILL.md content as string)
  content?: string;
  // For local skills: path to directory containing SKILL.md (relative to project root or absolute)
  path?: string;
  // Version or tag to checkout (e.g., "1.2.1" or "v1.2.1")
  version?: string;
  // Commit SHA to checkout (e.g., "abc123def456...")
  ref?: string;
}

export interface MCPServer {
  id: string;
  type: 'mcp';
  def: MCPServerDefinition;
  sourcePlugin?: SourcePlugin;
  /** Original mcpServers key from the plugin manifest. Used to look up per-server config (alias, tool filter). */
  sourcePluginServerKey?: string;
  /** User-facing name (e.g. "slack-server" for plugin servers); falls back to id if unset */
  displayName?: string;
  /** Human-readable description shown in capa sh */
  description?: string;
}

export interface MCPServerDefinition {
  // For remote MCP servers
  url?: string;
  headers?: Record<string, string>;
  /** Skip TLS certificate verification (e.g. for self-signed certs on internal servers) */
  tlsSkipVerify?: boolean;
  // For local MCP servers (subprocess)
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory for subprocess (e.g. plugin root) */
  cwd?: string;
  // OAuth2 config (auto-detected, not user-specified)
  oauth2?: OAuth2Config;
}

export interface Tool {
  id: string;
  type: 'mcp' | 'command';
  def: ToolMCPDefinition | ToolCommandDefinition;
  sourcePlugin?: SourcePlugin;
  /** Human-readable description shown in capa sh */
  description?: string;
  /**
   * Optional group name for command-type tools. Tools sharing the same group are
   * nested under a parent command in capa sh. If only one tool belongs to the group
   * it is displayed at the top level directly.
   */
  group?: string;
}

export interface ToolMCPDefinition {
  server: string; // Reference to server ID with @ prefix
  tool: string;   // Tool name on the remote MCP server
  /** Default argument values merged at call time; defaulted params become optional in the schema. */
  defaults?: Record<string, any>;
}

export interface ToolCommandDefinition {
  init?: CommandSpec;
  run: CommandSpec;
}

export interface CommandSpec {
  cmd: string;
  args?: ArgumentDefinition[];
  dir?: string;
  env?: Record<string, string>;
}

export interface ArgumentDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: any;
}

/**
 * Compute the qualified name for a tool.
 * MCP tools:              "{serverId}.{toolId}" (e.g. "bigquery.query")
 * Command tools w/ group: "{group}.{toolId}"    (e.g. "git.commit")
 * Command tools w/o group: "{toolId}"           (unchanged)
 */
export function getQualifiedToolName(tool: Tool): string {
  if (tool.type === 'mcp') {
    const mcpDef = tool.def as ToolMCPDefinition;
    const serverId = mcpDef.server.replace('@', '');
    return `${serverId}.${tool.id}`;
  }
  if (tool.group) {
    return `${tool.group}.${tool.id}`;
  }
  return tool.id;
}

/**
 * Normalize a tool name for comparison by collapsing dots and underscores.
 * Many MCP clients replace dots with underscores in tool names, so
 * "brave.search" and "brave_search" should resolve to the same tool.
 */
export function normalizeToolName(name: string): string {
  return name.replace(/\./g, '_');
}

/**
 * Normalize a skill `requires` reference to a qualified tool name.
 * "@server.tool" → "server.tool" (MCP tool)
 * "plain_id"     → "plain_id"   (command tool)
 */
export function normalizeToolReference(ref: string): string {
  return ref.startsWith('@') ? ref.slice(1) : ref;
}

/**
 * Resolve a subagent `tools[]` entry to a Tool object. Accepts three forms
 * for the same tool, so users coming from `requires` syntax don't have to
 * learn a second dialect:
 *
 *   "@dbx.sql_read_only"  — requires-style, leading @
 *   "dbx.sql_read_only"   — qualified, no @
 *   "sql_read_only"       — bare local tool id
 *
 * Returns `undefined` if no tool matches.
 */
export function resolveSubagentToolRef(ref: string, tools: Tool[]): Tool | undefined {
  const stripped = ref.startsWith('@') ? ref.slice(1) : ref;
  // Qualified-name match handles "@server.tool", "server.tool", and the
  // ungrouped command-tool case (where the qualified name equals the id).
  const byQualified = tools.find((t) => getQualifiedToolName(t) === stripped);
  if (byQualified) return byQualified;
  // Fall back to bare-id match for MCP / grouped command tools written
  // without their server/group prefix.
  return tools.find((t) => t.id === stripped);
}
