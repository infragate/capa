import type { Database } from 'bun:sqlite';
import type { ToolInitState } from '../types/database';

export class ToolInitStateRepo {
  constructor(private db: Database) {}

  setInitialized(projectId: string, toolId: string, error: string | null = null): void {
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

  get(projectId: string, toolId: string): ToolInitState | null {
    return this.db.query(
      'SELECT * FROM tool_init_state WHERE project_id = ? AND tool_id = ?'
    ).get(projectId, toolId) as ToolInitState | null;
  }
}
