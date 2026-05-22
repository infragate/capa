import type { Database } from 'bun:sqlite';

export function initSchema(db: Database): void {
  db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

  db.run(`
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

  db.run(`
      CREATE TABLE IF NOT EXISTS managed_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, file_path)
      )
    `);

  db.run(`
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

  db.run(`
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

  db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        skill_ids TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

  db.run(`
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

  db.run(`
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

  db.run(`
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

  db.run(`
      CREATE TABLE IF NOT EXISTS project_capabilities (
        project_id TEXT PRIMARY KEY,
        capabilities_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

  db.run(`
      CREATE TABLE IF NOT EXISTS sub_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, agent_id)
      )
    `);

  db.run(`
      CREATE TABLE IF NOT EXISTS project_providers (
        project_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, provider_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

  db.run(`
      CREATE TABLE IF NOT EXISTS registries (
        slug TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('github','gitlab','url')),
        source TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','installed','failed','disabled')),
        last_error TEXT,
        resolved_ref TEXT,
        installed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

  // Generic key/value store for small server-wide flags that don't deserve
  // their own table (e.g. "have we seeded the default registries yet").
  db.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
}
