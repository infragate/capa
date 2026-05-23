import type { Database } from 'bun:sqlite';
import type { Session } from '../types/database';

export class SessionsRepo {
  constructor(private db: Database) {}

  create(sessionId: string, projectId: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO sessions (session_id, project_id, skill_ids, created_at, last_activity)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, projectId, '[]', now, now]
    );
  }

  get(sessionId: string): Session | null {
    return this.db.query('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | null;
  }

  updateActivity(sessionId: string): void {
    const now = Date.now();
    this.db.run(
      'UPDATE sessions SET last_activity = ? WHERE session_id = ?',
      [now, sessionId]
    );
  }

  updateSkills(sessionId: string, skillIds: string[]): void {
    const now = Date.now();
    this.db.run(
      'UPDATE sessions SET skill_ids = ?, last_activity = ? WHERE session_id = ?',
      [JSON.stringify(skillIds), now, sessionId]
    );
  }

  delete(sessionId: string): void {
    this.db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  }

  deleteExpired(timeoutMinutes: number): void {
    const cutoff = Date.now() - timeoutMinutes * 60 * 1000;
    this.db.run('DELETE FROM sessions WHERE last_activity < ?', [cutoff]);
  }
}
