import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
  Project,
  Variable,
  ManagedFile,
  ToolInitState,
  MCPSubprocess,
  Session,
  GitIntegration,
} from '../types/database';

export class CapaDatabase {
  private db: Database;

  constructor(dbPath: string) {
    // Ensure parent directory exists before creating database
    const dbDir = dirname(dbPath);
    mkdirSync(dbDir, { recursive: true });
    
    this.db = new Database(dbPath, { create: true });
    this.initSchema();
  }

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS variables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, key)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS managed_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, file_path)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_init_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        initialized INTEGER DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, tool_id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS mcp_subprocesses (
        id TEXT PRIMARY KEY,
        config_hash TEXT UNIQUE NOT NULL,
        pid INTEGER,
        port INTEGER,
        status TEXT,
        started_at INTEGER,
        last_health_check INTEGER
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        skill_ids TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT DEFAULT 'Bearer',
        expires_at INTEGER,
        scope TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, server_id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS oauth_flow_state (
        state TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS git_integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        host TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT DEFAULT 'Bearer',
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform, host)
      )
    `);
  }

  // Project operations
  upsertProject(project: Omit<Project, 'created_at' | 'updated_at'>): void {
    const now = Date.now();
    const existing = this.db.query('SELECT id FROM projects WHERE id = ?').get(project.id);
    
    if (existing) {
      this.db.run(
        'UPDATE projects SET path = ?, updated_at = ? WHERE id = ?',
        [project.path, now, project.id]
      );
    } else {
      this.db.run(
        'INSERT INTO projects (id, path, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [project.id, project.path, now, now]
      );
    }
  }

  getProject(id: string): Project | null {
    return this.db.query('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
  }

  getProjectByPath(path: string): Project | null {
    return this.db.query('SELECT * FROM projects WHERE path = ?').get(path) as Project | null;
  }

  getAllProjects(): Project[] {
    return this.db.query('SELECT * FROM projects ORDER BY updated_at DESC').all() as Project[];
  }

  // Variable operations
  setVariable(projectId: string, key: string, value: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO variables (project_id, key, value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = ?, created_at = ?`,
      [projectId, key, value, now, value, now]
    );
  }

  getVariable(projectId: string, key: string): string | null {
    const result = this.db.query(
      'SELECT value FROM variables WHERE project_id = ? AND key = ?'
    ).get(projectId, key) as { value: string } | null;
    return result?.value ?? null;
  }

  getAllVariables(projectId: string): Record<string, string> {
    const rows = this.db.query(
      'SELECT key, value FROM variables WHERE project_id = ?'
    ).all(projectId) as Array<{ key: string; value: string }>;
    
    const vars: Record<string, string> = {};
    for (const row of rows) {
      vars[row.key] = row.value;
    }
    return vars;
  }

  deleteVariable(projectId: string, key: string): void {
    this.db.run(
      'DELETE FROM variables WHERE project_id = ? AND key = ?',
      [projectId, key]
    );
  }

  // Managed files operations
  addManagedFile(projectId: string, filePath: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO managed_files (project_id, file_path, created_at)
       VALUES (?, ?, ?)`,
      [projectId, filePath, now]
    );
  }

  getManagedFiles(projectId: string): string[] {
    const rows = this.db.query(
      'SELECT file_path FROM managed_files WHERE project_id = ?'
    ).all(projectId) as Array<{ file_path: string }>;
    return rows.map(r => r.file_path);
  }

  removeManagedFile(projectId: string, filePath: string): void {
    this.db.run(
      'DELETE FROM managed_files WHERE project_id = ? AND file_path = ?',
      [projectId, filePath]
    );
  }

  clearManagedFiles(projectId: string): void {
    this.db.run('DELETE FROM managed_files WHERE project_id = ?', [projectId]);
  }

  // Tool init state operations
  setToolInitialized(projectId: string, toolId: string, error: string | null = null): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO tool_init_state (project_id, tool_id, initialized, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, tool_id) DO UPDATE SET
         initialized = ?,
         last_error = ?,
         updated_at = ?`,
      [projectId, toolId, error ? 0 : 1, error, now, error ? 0 : 1, error, now]
    );
  }

  getToolInitState(projectId: string, toolId: string): ToolInitState | null {
    return this.db.query(
      'SELECT * FROM tool_init_state WHERE project_id = ? AND tool_id = ?'
    ).get(projectId, toolId) as ToolInitState | null;
  }

  // MCP subprocess operations
  upsertMCPSubprocess(subprocess: Omit<MCPSubprocess, 'started_at' | 'last_health_check'> & Partial<Pick<MCPSubprocess, 'started_at' | 'last_health_check'>>): void {
    const now = Date.now();
    const existing = this.db.query('SELECT id FROM mcp_subprocesses WHERE id = ?').get(subprocess.id);
    
    if (existing) {
      this.db.run(
        `UPDATE mcp_subprocesses SET
          config_hash = ?,
          pid = ?,
          port = ?,
          status = ?,
          last_health_check = ?
         WHERE id = ?`,
        [
          subprocess.config_hash,
          subprocess.pid,
          subprocess.port,
          subprocess.status,
          subprocess.last_health_check ?? now,
          subprocess.id
        ]
      );
    } else {
      this.db.run(
        `INSERT INTO mcp_subprocesses (id, config_hash, pid, port, status, started_at, last_health_check)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          subprocess.id,
          subprocess.config_hash,
          subprocess.pid,
          subprocess.port,
          subprocess.status,
          subprocess.started_at ?? now,
          subprocess.last_health_check ?? now
        ]
      );
    }
  }

  getMCPSubprocess(id: string): MCPSubprocess | null {
    return this.db.query('SELECT * FROM mcp_subprocesses WHERE id = ?').get(id) as MCPSubprocess | null;
  }

  getMCPSubprocessByHash(hash: string): MCPSubprocess | null {
    return this.db.query('SELECT * FROM mcp_subprocesses WHERE config_hash = ?').get(hash) as MCPSubprocess | null;
  }

  getAllMCPSubprocesses(): MCPSubprocess[] {
    return this.db.query('SELECT * FROM mcp_subprocesses').all() as MCPSubprocess[];
  }

  deleteMCPSubprocess(id: string): void {
    this.db.run('DELETE FROM mcp_subprocesses WHERE id = ?', [id]);
  }

  // Session operations
  createSession(sessionId: string, projectId: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO sessions (session_id, project_id, skill_ids, created_at, last_activity)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, projectId, '[]', now, now]
    );
  }

  getSession(sessionId: string): Session | null {
    return this.db.query('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | null;
  }

  updateSessionActivity(sessionId: string): void {
    const now = Date.now();
    this.db.run(
      'UPDATE sessions SET last_activity = ? WHERE session_id = ?',
      [now, sessionId]
    );
  }

  updateSessionSkills(sessionId: string, skillIds: string[]): void {
    const now = Date.now();
    this.db.run(
      'UPDATE sessions SET skill_ids = ?, last_activity = ? WHERE session_id = ?',
      [JSON.stringify(skillIds), now, sessionId]
    );
  }

  deleteSession(sessionId: string): void {
    this.db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  }

  deleteExpiredSessions(timeoutMinutes: number): void {
    const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
    this.db.run('DELETE FROM sessions WHERE last_activity < ?', [cutoff]);
  }

  // OAuth2 token operations
  getOAuthToken(projectId: string, serverId: string): any | null {
    return this.db.query(
      'SELECT * FROM oauth_tokens WHERE project_id = ? AND server_id = ?'
    ).get(projectId, serverId);
  }

  setOAuthToken(projectId: string, serverId: string, tokenData: {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_at?: number;
    scope?: string;
  }): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO oauth_tokens (project_id, server_id, access_token, refresh_token, token_type, expires_at, scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, server_id) DO UPDATE SET
         access_token = ?,
         refresh_token = ?,
         token_type = ?,
         expires_at = ?,
         scope = ?,
         updated_at = ?`,
      [
        projectId, serverId, tokenData.access_token, tokenData.refresh_token || null,
        tokenData.token_type || 'Bearer', tokenData.expires_at || null, tokenData.scope || null,
        now, now,
        tokenData.access_token, tokenData.refresh_token || null, tokenData.token_type || 'Bearer',
        tokenData.expires_at || null, tokenData.scope || null, now
      ]
    );
  }

  deleteOAuthToken(projectId: string, serverId: string): void {
    this.db.run(
      'DELETE FROM oauth_tokens WHERE project_id = ? AND server_id = ?',
      [projectId, serverId]
    );
  }

  getAllOAuthTokens(projectId: string): any[] {
    return this.db.query(
      'SELECT * FROM oauth_tokens WHERE project_id = ?'
    ).all(projectId);
  }

  // OAuth2 flow state operations
  storeFlowState(state: string, projectId: string, serverId: string, codeVerifier: string, redirectUri: string, clientId?: string): void {
    const now = Date.now();
    // Store client_id in the state so we can use it during token exchange
    const stateData = JSON.stringify({
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId || 'capa',
    });
    this.db.run(
      `INSERT INTO oauth_flow_state (state, project_id, server_id, code_verifier, redirect_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [state, projectId, serverId, stateData, redirectUri, now]
    );
  }

  getFlowState(state: string): any | null {
    return this.db.query(
      'SELECT * FROM oauth_flow_state WHERE state = ?'
    ).get(state);
  }

  deleteFlowState(state: string): void {
    this.db.run('DELETE FROM oauth_flow_state WHERE state = ?', [state]);
  }

  deleteExpiredFlowStates(timeoutMinutes: number = 10): void {
    const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
    this.db.run('DELETE FROM oauth_flow_state WHERE created_at < ?', [cutoff]);
  }

  // Git integration operations
  getGitIntegration(platform: string, host: string | null = null): GitIntegration | null {
    return this.db.query(
      'SELECT * FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))'
    ).get(platform, host, host) as GitIntegration | null;
  }

  setGitIntegration(
    platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed',
    tokenData: {
      host?: string | null;
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    const now = Date.now();
    const host = tokenData.host || null;
    
    this.db.run(
      `INSERT INTO git_integrations (platform, host, access_token, refresh_token, token_type, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, host) DO UPDATE SET
         access_token = ?,
         refresh_token = ?,
         token_type = ?,
         expires_at = ?,
         updated_at = ?`,
      [
        platform, host, tokenData.access_token, tokenData.refresh_token || null,
        tokenData.token_type || 'Bearer', tokenData.expires_at || null,
        now, now,
        tokenData.access_token, tokenData.refresh_token || null, tokenData.token_type || 'Bearer',
        tokenData.expires_at || null, now
      ]
    );
  }

  deleteGitIntegration(platform: string, host: string | null = null): void {
    this.db.run(
      'DELETE FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))',
      [platform, host, host]
    );
  }

  getAllGitIntegrations(): GitIntegration[] {
    return this.db.query('SELECT * FROM git_integrations ORDER BY created_at DESC').all() as GitIntegration[];
  }

  // Convenience methods for CLI git client (uses provider string format like "github.com" or "gitlab.com")
  getGitOAuthToken(provider: string): GitIntegration | null {
    // Map provider string to platform
    const platformMap: Record<string, 'github' | 'gitlab'> = {
      'github.com': 'github',
      'gitlab.com': 'gitlab',
    };
    
    const platform = platformMap[provider];
    if (!platform) {
      return null;
    }
    
    return this.getGitIntegration(platform, null);
  }

  setGitOAuthToken(
    provider: string,
    tokenData: {
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    // Map provider string to platform
    const platformMap: Record<string, 'github' | 'gitlab'> = {
      'github.com': 'github',
      'gitlab.com': 'gitlab',
    };
    
    const platform = platformMap[provider];
    if (!platform) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    
    this.setGitIntegration(platform, tokenData);
  }

  getAllGitOAuthTokens(): Array<GitIntegration & { provider: string }> {
    const integrations = this.getAllGitIntegrations();
    
    // Map platforms back to provider strings and filter for OAuth providers
    return integrations
      .filter(i => i.platform === 'github' || i.platform === 'gitlab')
      .map(integration => ({
        ...integration,
        provider: integration.platform === 'github' ? 'github.com' : 'gitlab.com',
      }));
  }

  close(): void {
    this.db.close();
  }
}
