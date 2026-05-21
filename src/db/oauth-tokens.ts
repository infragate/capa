import type { Database } from 'bun:sqlite';
import type { OAuthTokenRow } from '../types/database';

export class OAuthTokensRepo {
  constructor(private db: Database) {}

  get(projectId: string, serverId: string): OAuthTokenRow | null {
    return this.db.query(
      'SELECT * FROM oauth_tokens WHERE project_id = ? AND server_id = ?'
    ).get(projectId, serverId) as OAuthTokenRow | null;
  }

  set(projectId: string, serverId: string, tokenData: {
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

  delete(projectId: string, serverId: string): void {
    this.db.run(
      'DELETE FROM oauth_tokens WHERE project_id = ? AND server_id = ?',
      [projectId, serverId]
    );
  }

  getAll(projectId: string): OAuthTokenRow[] {
    return this.db.query(
      'SELECT * FROM oauth_tokens WHERE project_id = ?'
    ).all(projectId) as OAuthTokenRow[];
  }
}
