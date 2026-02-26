// Capabilities file types

import type { Plugin, SourcePlugin, ResolvedPluginInfo } from './plugin';

export type CapabilitiesFormat = 'json' | 'yaml';
export type { Plugin, SourcePlugin, ResolvedPluginInfo } from './plugin';

/**
 * Tool exposure modes for MCP clients
 * - 'expose-all': All tools from all skills are exposed immediately (default)
 * - 'on-demand': Tools are only exposed after calling setup_tools
 */
export type ToolExposureMode = 'expose-all' | 'on-demand';

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
   * Determines how tools are exposed to MCP clients
   * @default 'expose-all'
   */
  toolExposure?: ToolExposureMode;
  /**
   * Security options for skill installation (blocked phrases, character sanitization)
   */
  security?: SecurityOptions;
}

/**
 * Repository + file definition for github/gitlab agent snippets.
 * Follows the same `repo` string format used by Skill: "owner/repo@filepath"
 * with an optional ":version" tag or "#sha" suffix.
 *
 * Examples:
 *   "vercel-labs/agent-skills@AGENTS.md"
 *   "vercel-labs/agent-skills@docs/tips.md:v1.2.0"
 *   "vercel-labs/agent-skills@AGENTS.md#abc123def"
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
 *   - github  : file fetched from a GitHub repository ("owner/repo@filepath")
 *   - gitlab  : file fetched from a GitLab repository ("group/repo@filepath")
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
 * Supports the same source types as snippets (remote, github, gitlab).
 *
 * Examples:
 *   ref: https://raw.githubusercontent.com/org/repo/main/AGENTS.md   # remote URL
 *   type: github / def.repo: org/repo@AGENTS.md                       # GitHub file
 *   type: gitlab / def.repo: group/repo@AGENTS.md:v1.0.0              # GitLab file, pinned
 */
export interface AgentFileBase {
  /**
   * Source type. Defaults to 'remote' when `ref` is set and `type` is omitted.
   * Use 'github' or 'gitlab' together with `def.repo` for repository-hosted files.
   */
  type?: 'remote' | 'github' | 'gitlab';
  /** Raw URL — used when type is 'remote' (or when type is omitted and ref is present). */
  ref?: string;
  /** Repository + file definition for github/gitlab types. */
  def?: AgentSnippetDef;
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

export interface Capabilities {
  providers: string[];
  skills: Skill[];
  servers: MCPServer[];
  tools: Tool[];
  plugins?: Plugin[];
  /** Resolved plugin metadata (name, version, provider, repository) for display */
  resolvedPlugins?: ResolvedPluginInfo[];
  options?: CapabilitiesOptions;
  /** Manages content written to AGENTS.md / CLAUDE.md in the project root. */
  agents?: AgentFileConfig;
}

export interface Skill {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  def: SkillDefinition;
  sourcePlugin?: SourcePlugin;
}

export interface SkillDefinition {
  description?: string;
  requires?: string[]; // Tool IDs
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
  /** User-facing name (e.g. "slack-server" for plugin servers); falls back to id if unset */
  displayName?: string;
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
  oauth2?: any; // OAuth2Config from types/oauth.ts
}

export interface Tool {
  id: string;
  type: 'mcp' | 'command';
  def: ToolMCPDefinition | ToolCommandDefinition;
  sourcePlugin?: SourcePlugin;
}

export interface ToolMCPDefinition {
  server: string; // Reference to server ID with @ prefix
  tool: string;   // Tool name on the remote MCP server
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
}
