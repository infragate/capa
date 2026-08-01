// Database types

export interface Project {
  id: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export interface Variable {
  id: number;
  project_id: string;
  key: string;
  value: string;
  created_at: number;
}

export interface ManagedFile {
  id: number;
  project_id: string;
  file_path: string;
  created_at: number;
}

export interface ToolInitState {
  id: number;
  project_id: string;
  tool_id: string;
  initialized: boolean;
  last_error: string | null;
  updated_at: number;
}

export interface MCPSubprocess {
  id: string;
  config_hash: string;
  pid: number | null;
  port: number | null;
  status: 'running' | 'crashed' | 'stopped';
  started_at: number;
  last_health_check: number;
}

export interface Session {
  session_id: string;
  project_id: string;
  skill_ids: string; // JSON array
  created_at: number;
  last_activity: number;
}

export type ToolCallStatus = 'running' | 'ok' | 'error';
export type ToolCallKind = 'setup_tools' | 'call_tool' | 'tool';

export interface ToolCallRecord {
  id: string;
  project_id: string;
  session_id: string | null;
  started_at: number;
  duration_ms: number | null;
  status: ToolCallStatus;
  /** `shell` for capa sh; otherwise MCP client name or `mcp`. */
  source: string | null;
  kind: ToolCallKind;
  tool_name: string;
  meta_tool: string | null;
  args_json: string | null;
  result_preview: string | null;
  /** UTF-8 byte length of the original (pre-truncate) result text. */
  result_bytes: number | null;
  /** Estimated tokens for the original result (~chars/4). */
  result_tokens: number | null;
  error_message: string | null;
  agent_id: string | null;
}

/** One-minute activity bucket for the last-hour chart. */
export interface ToolCallBucket {
  /** Start of the minute (epoch ms). */
  t: number;
  count: number;
}

export interface ToolCallStats {
  total: number;
  errors: number;
  avg_duration_ms: number | null;
  shell: number;
  mcp: number;
  window_ms: number;
  /** 60 one-minute buckets ending at the current minute. */
  buckets: ToolCallBucket[];
}

export interface GitIntegration {
  id: number;
  platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed';
  host: string | null; // For self-managed instances
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OAuthTokenRow {
  id: number;
  project_id: string;
  server_id: string;
  access_token: string;
  refresh_token: string | null;
  token_type: string | null;
  expires_at: number | null;
  scope: string | null;
  created_at: number;
  updated_at: number;
}

export interface OAuthFlowStateRow {
  state: string;
  project_id: string;
  server_id: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: number;
}

export type RegistrySourceType = 'github' | 'gitlab' | 'url';
export type RegistryStatus = 'pending' | 'installed' | 'failed' | 'disabled';

export interface RegistryRow {
  slug: string;
  type: RegistrySourceType;
  source: string;
  enabled: number;
  status: RegistryStatus;
  last_error: string | null;
  resolved_ref: string | null;
  installed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface RegistryRecord {
  slug: string;
  type: RegistrySourceType;
  source: string;
  enabled: boolean;
  status: RegistryStatus;
  lastError: string | null;
  resolvedRef: string | null;
  installedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServerSettings {
  version: string;
  server: {
    port: number;
    host: string;
  };
  database: {
    path: string;
  };
  session: {
    timeout_minutes: number;
  };
  token_refresh?: {
    check_interval_seconds?: number;
    refresh_threshold_seconds?: number;
  };
}
