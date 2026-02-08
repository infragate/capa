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
}
