// Capabilities file types

export type CapabilitiesFormat = 'json' | 'yaml';

/**
 * Tool exposure modes for MCP clients
 * - 'expose-all': All tools from all skills are exposed immediately (default)
 * - 'on-demand': Tools are only exposed after calling setup_tools
 */
export type ToolExposureMode = 'expose-all' | 'on-demand';

/**
 * Configuration options for capabilities behavior
 */
export interface CapabilitiesOptions {
  /**
   * Determines how tools are exposed to MCP clients
   * @default 'expose-all'
   */
  toolExposure?: ToolExposureMode;
}

export interface Capabilities {
  clients: string[];
  skills: Skill[];
  servers: MCPServer[];
  tools: Tool[];
  options?: CapabilitiesOptions;
}

export interface Skill {
  id: string;
  type: 'inline' | 'remote' | 'github';
  def: SkillDefinition;
}

export interface SkillDefinition {
  description?: string;
  requires?: string[]; // Tool IDs
  // For remote skills (raw SKILL.md URL)
  url?: string;
  // For GitHub skills (e.g., "vercel-labs/agent-skills@find-skills")
  repo?: string;
  // For inline skills (SKILL.md content as string)
  content?: string;
}

export interface MCPServer {
  id: string;
  type: 'mcp';
  def: MCPServerDefinition;
}

export interface MCPServerDefinition {
  // For remote MCP servers
  url?: string;
  headers?: Record<string, string>;
  // For local MCP servers (subprocess)
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  // OAuth2 config (auto-detected, not user-specified)
  oauth2?: any; // OAuth2Config from types/oauth.ts
}

export interface Tool {
  id: string;
  type: 'mcp' | 'command';
  def: ToolMCPDefinition | ToolCommandDefinition;
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
