import type { Database } from 'bun:sqlite';

export class ManagedFilesRepo {
  constructor(private db: Database) {}

  add(projectId: string, filePath: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO managed_files (project_id, file_path, created_at)
       VALUES (?, ?, ?)`,
      [projectId, filePath, now]
    );
  }

  getAll(projectId: string): string[] {
    const rows = this.db.query(
      'SELECT file_path FROM managed_files WHERE project_id = ?'
    ).all(projectId) as Array<{ file_path: string }>;
    return rows.map(r => r.file_path);
  }

  remove(projectId: string, filePath: string): void {
    this.db.run(
      'DELETE FROM managed_files WHERE project_id = ? AND file_path = ?',
      [projectId, filePath]
    );
  }

  clear(projectId: string): void {
    this.db.run('DELETE FROM managed_files WHERE project_id = ?', [projectId]);
  }
}
