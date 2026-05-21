import type { Database } from 'bun:sqlite';
import type { Project } from '../types/database';

export class ProjectsRepo {
  constructor(private db: Database) {}

  upsert(project: Omit<Project, 'created_at' | 'updated_at'>): void {
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

  get(id: string): Project | null {
    return this.db.query('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
  }

  getByPath(path: string): Project | null {
    return this.db.query('SELECT * FROM projects WHERE path = ?').get(path) as Project | null;
  }

  getAll(): Project[] {
    return this.db.query('SELECT * FROM projects ORDER BY updated_at DESC').all() as Project[];
  }

  delete(projectId: string): void {
    const tx = this.db.transaction((id: string) => {
      this.db.run('DELETE FROM variables WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM managed_files WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM tool_init_state WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM sessions WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM oauth_tokens WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM oauth_flow_state WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM project_capabilities WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM sub_agents WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM project_providers WHERE project_id = ?', [id]);
      this.db.run('DELETE FROM projects WHERE id = ?', [id]);
    });
    tx(projectId);
  }

  setProviders(projectId: string, providers: string[]): void {
    const now = Date.now();
    this.db.run('DELETE FROM project_providers WHERE project_id = ?', [projectId]);
    const seen = new Set<string>();
    for (const pid of providers) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      this.db.run(
        'INSERT INTO project_providers (project_id, provider_id, created_at) VALUES (?, ?, ?)',
        [projectId, pid, now]
      );
    }
  }

  getProviders(projectId: string): string[] {
    const rows = this.db.query(
      'SELECT provider_id FROM project_providers WHERE project_id = ? ORDER BY rowid'
    ).all(projectId) as Array<{ provider_id: string }>;
    return rows.map((r) => r.provider_id);
  }

  setCapabilities(projectId: string, capabilitiesJson: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO project_capabilities (project_id, capabilities_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET capabilities_json = ?, updated_at = ?`,
      [projectId, capabilitiesJson, now, capabilitiesJson, now]
    );
  }

  getCapabilities(projectId: string): string | null {
    const row = this.db.query(
      'SELECT capabilities_json FROM project_capabilities WHERE project_id = ?'
    ).get(projectId) as { capabilities_json: string } | null;
    return row?.capabilities_json ?? null;
  }
}
