import type { Database } from 'bun:sqlite';
import type { OAuthFlowStateRow } from '../types/database';

export class OAuthFlowStateRepo {
  constructor(private db: Database) {}

  store(state: string, projectId: string, serverId: string, codeVerifier: string, redirectUri: string, clientId?: string): void {
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

  get(state: string): OAuthFlowStateRow | null {
    return this.db.query(
      'SELECT * FROM oauth_flow_state WHERE state = ?'
    ).get(state) as OAuthFlowStateRow | null;
  }

  delete(state: string): void {
    this.db.run('DELETE FROM oauth_flow_state WHERE state = ?', [state]);
  }

  deleteExpired(timeoutMinutes: number = 10): void {
    const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
    this.db.run('DELETE FROM oauth_flow_state WHERE created_at < ?', [cutoff]);
  }
}
