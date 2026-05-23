import type { Database } from 'bun:sqlite';

export class SubAgentsRepo {
  constructor(private db: Database) {}

  upsert(projectId: string, agentId: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO sub_agents (project_id, agent_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id, agent_id) DO NOTHING`,
      [projectId, agentId, now]
    );
  }

  getAll(projectId: string): Array<{ agent_id: string }> {
    return this.db.query(
      'SELECT agent_id FROM sub_agents WHERE project_id = ?'
    ).all(projectId) as Array<{ agent_id: string }>;
  }

  remove(projectId: string, agentId: string): void {
    this.db.run(
      'DELETE FROM sub_agents WHERE project_id = ? AND agent_id = ?',
      [projectId, agentId]
    );
  }
}
