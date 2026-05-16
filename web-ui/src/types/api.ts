export interface ProjectSummary {
  id: string;
  path: string;
  created_at: string;
  updated_at: string;
  skills_count: number;
  tools_count: number;
  servers_count: number;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface SourcePlugin {
  name: string;
  repository?: string;
  provider?: string;
  version?: string;
}

export interface Skill {
  id: string;
  type: string;
  description: string | null;
  requires: string[];
  sourcePlugin: SourcePlugin | null;
}

export interface Tool {
  id: string;
  type: 'mcp' | 'command';
  sourcePlugin: SourcePlugin | null;
  mcpServer?: string;
  mcpTool?: string;
  command?: string;
  commandArgs?: CommandArg[];
}

export interface CommandArg {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
}

export interface EnrichedTool extends Tool {
  _description?: string;
  _inputSchema?: ToolInputSchema;
}

export interface Server {
  id: string;
  type: string;
  url: string | null;
  cmd: string | null;
  args: string[] | null;
  sourcePlugin: SourcePlugin | null;
  displayName: string | null;
  requiresOAuth: boolean;
  isConnected: boolean | null;
  description?: string;
}

export interface ResolvedPlugin {
  name: string;
  repository?: string;
  provider?: string;
  version?: string;
  /** Skill IDs exposed by the plugin's manifest. */
  skills?: string[];
  /** Capa server IDs (after `as` rename) the plugin contributed. */
  serverIds?: string[];
}

export interface SubAgent {
  id: string;
  description: string | null;
  skills: string[];
  tools: string[];
  instructions: string | null;
}

export interface Rule {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab';
  description: string | null;
  providers: string[];
  appliesTo: string[];
  alwaysApply: boolean;
}

export interface RequiredCommand {
  cli: string;
  description: string | null;
}

export interface SecurityOptions {
  blockedPhrases: string[];
  allowedCharacters: string | null;
}

export interface CapabilitiesOptions {
  toolExposure: string | null;
  security: SecurityOptions | null;
  requiresCommands: RequiredCommand[];
}

export interface ProjectCapabilities {
  skills: Skill[];
  tools: Tool[];
  servers: Server[];
  resolvedPlugins: ResolvedPlugin[] | null;
  providers: string[];
  subagents: SubAgent[];
  rules: Rule[];
  options: CapabilitiesOptions | null;
}

export interface ProjectDetail {
  id: string;
  path: string;
  created_at: string;
  updated_at: string;
  capabilities: ProjectCapabilities | null;
}

export interface VariablesResponse {
  required: string[];
  values: Record<string, string>;
}

export interface OAuth2Server {
  serverId: string;
  displayName: string | null;
  isConnected: boolean;
  expiresAt: string | null;
}

export interface OAuth2ServersResponse {
  servers: OAuth2Server[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: ToolInputSchema;
}

export interface ToolInputSchema {
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type?: string;
  description?: string;
}

export interface ServerToolsResponse {
  tools: ToolSchema[];
}

export interface Integration {
  platform: string;
  host?: string;
  displayName: string;
  isConnected: boolean;
  expiresAt: string | null;
}

export interface IntegrationsResponse {
  integrations: Integration[];
}

export interface OAuthStartResponse {
  authorizationUrl?: string;
  error?: string;
}

export interface ActionResponse {
  success: boolean;
  error?: string;
}
