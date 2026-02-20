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

export interface Capabilities {
  providers: string[];
  skills: Skill[];
  servers: MCPServer[];
  tools: Tool[];
  plugins?: Plugin[];
  /** Resolved plugin metadata (name, version, provider, repository) for display */
  resolvedPlugins?: ResolvedPluginInfo[];
  options?: CapabilitiesOptions;
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
