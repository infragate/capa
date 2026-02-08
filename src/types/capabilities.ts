// Capabilities file types

export type CapabilitiesFormat = 'json' | 'yaml';

export interface Capabilities {
  clients: string[];
  skills: Skill[];
  servers: MCPServer[];
  tools: Tool[];
}

export interface Skill {
  id: string;
  type: 'inline' | 'remote';
  def: SkillDefinition;
}

export interface SkillDefinition {
  description: string;
  requires: string[]; // Tool IDs
  // For remote skills
  url?: string;
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
