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
  descriptionSource?: 'capabilities' | 'frontmatter' | null;
  requires: string[];
  content?: string | null;
  /** Project-relative path for type: local skills (directory containing SKILL.md). */
  path?: string | null;
  sourcePlugin: SourcePlugin | null;
  /** External origin URL for github / gitlab / remote / plugin skills. */
  sourceUrl?: string | null;
}

export interface Tool {
  id: string;
  type: 'mcp' | 'command';
  description?: string | null;
  sourcePlugin: SourcePlugin | null;
  mcpServer?: string;
  mcpTool?: string;
  defaults?: Record<string, unknown> | null;
  formatter?: { cmd: string; timeout?: number } | null;
  command?: string;
  commandArgs?: CommandArg[];
  /** Optional group name for command-type tools. */
  group?: string;
}

export interface SkillContentResponse {
  id: string;
  content: string;
  metadata: {
    name: string;
    description?: string;
    [key: string]: unknown;
  };
  files: string[];
}

export interface CommandArg {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface EnrichedTool extends Tool {
  _description?: string;
  _inputSchema?: ToolInputSchema;
}

export interface ServerOAuth2Config {
  clientId: string | null;
  clientSecret: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  scopes: string[] | null;
  redirectUri: string | null;
  pkce: boolean;
}

export interface Server {
  id: string;
  type: string;
  url: string | null;
  cmd: string | null;
  args: string[] | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  cwd?: string | null;
  tlsSkipVerify?: boolean;
  oauth2?: ServerOAuth2Config | null;
  sourcePlugin: SourcePlugin | null;
  displayName: string | null;
  requiresOAuth: boolean;
  isConnected: boolean | null;
  description?: string | null;
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
  subagentIds?: string[];
  hookIds?: string[];
  ruleIds?: string[];
}

export interface SubAgent {
  id: string;
  description: string | null;
  skills: string[];
  tools: string[];
  instructions: string | null;
  sourcePlugin: SourcePlugin | null;
}

export interface Rule {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  description: string | null;
  providers: string[];
  appliesTo: string[];
  alwaysApply: boolean;
  content?: string | null;
  url?: string | null;
  path?: string | null;
  def?: { repo: string } | null;
  sourcePlugin: SourcePlugin | null;
}

export interface InstalledHook {
  providerId: string;
  configPath: string;
  scriptPath: string | null;
}

export interface Hook {
  id: string;
  description: string | null;
  on: string;
  type: 'command' | 'prompt';
  providers: string[];
  matcher: string | null;
  timeout: number | null;
  failClosed: boolean;
  sequential: boolean;
  /** Source type when the hook body is fetched from outside (`inline`/`remote`/`github`/`gitlab`/`local`). */
  sourceType: 'inline' | 'remote' | 'github' | 'gitlab' | 'local' | null;
  command: string | null;
  prompt: string | null;
  /** Inline `source.content` when body lives under `source` instead of command/prompt. */
  sourceContent?: string | null;
  /** One row per provider where capa successfully installed this hook. */
  installed: InstalledHook[];
  sourcePlugin: SourcePlugin | null;
}

export interface AuthoredPlugin {
  id: string | null;
  type: string;
  def: {
    repo: string;
    version?: string;
    ref?: string;
    subpath?: string;
  };
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
  /** Default true when omitted from capabilities file. */
  agentActivity: boolean;
  security: SecurityOptions | null;
  requiresCommands: RequiredCommand[];
}

export interface AgentSnippetDef {
  repo: string;
}

export interface AgentFileBase {
  type: string | null;
  ref: string | null;
  path: string | null;
  def: AgentSnippetDef | null;
}

export interface AgentSnippet {
  id: string | null;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local' | string;
  content: string | null;
  url: string | null;
  path: string | null;
  def: AgentSnippetDef | null;
}

export interface AgentFileConfig {
  base: AgentFileBase | null;
  additional: AgentSnippet[];
}

export interface ProjectFsEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export interface ProjectFsListResponse {
  path: string;
  entries: ProjectFsEntry[];
}

export interface ProjectFsUploadResponse {
  path: string;
}

export interface ProjectCapabilities {
  skills: Skill[];
  tools: Tool[];
  servers: Server[];
  resolvedPlugins: ResolvedPlugin[] | null;
  plugins?: AuthoredPlugin[];
  providers: string[];
  subagents: SubAgent[];
  rules: Rule[];
  hooks: Hook[];
  agents: AgentFileConfig | null;
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
  catalog: string[];
  values: Record<string, string>;
}

export interface CapabilitiesMutationResponse {
  success: boolean;
  needsCredentials?: boolean;
  missingVars?: string[];
  oauth2Servers?: string[];
  error?: string;
  [key: string]: unknown;
}

export type CapabilitySection =
  | 'skills'
  | 'servers'
  | 'tools'
  | 'plugins'
  | 'subagents'
  | 'rules'
  | 'hooks';

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

export type ToolCallStatus = 'running' | 'ok' | 'error';
export type ToolCallKind =
  | 'setup_tools'
  | 'call_tool'
  | 'tool'
  | 'prompt'
  | 'shell'
  | 'file'
  | 'skill'
  | 'session'
  | 'subagent'
  | 'compact'
  | 'stop'
  | 'agent_mcp'
  | 'agent_tool';

export interface ToolCallRecord {
  id: string;
  project_id: string;
  session_id: string | null;
  started_at: number;
  duration_ms: number | null;
  status: ToolCallStatus;
  source: string | null;
  kind: ToolCallKind;
  tool_name: string;
  meta_tool: string | null;
  args_json: string | null;
  result_preview: string | null;
  result_bytes: number | null;
  result_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  error_message: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  generation_id: string | null;
}

export interface ActivityResponse {
  calls: ToolCallRecord[];
  total: number;
  hasMore: boolean;
}

export interface ActivityBucket {
  t: number;
  count: number;
}

export interface ActivityStats {
  total: number;
  errors: number;
  avg_duration_ms: number | null;
  shell: number;
  mcp: number;
  window_ms: number;
  buckets: ActivityBucket[];
}

export interface ActionResponse {
  success: boolean;
  error?: string;
}
