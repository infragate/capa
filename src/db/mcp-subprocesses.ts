import type { Database } from 'bun:sqlite';
import type { MCPSubprocess } from '../types/database';

export class MCPSubprocessesRepo {
  constructor(private db: Database) {}

  upsert(subprocess: Omit<MCPSubprocess, 'started_at' | 'last_health_check'> & Partial<Pick<MCPSubprocess, 'started_at' | 'last_health_check'>>): void {
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

  get(id: string): MCPSubprocess | null {
    return this.db.query('SELECT * FROM mcp_subprocesses WHERE id = ?').get(id) as MCPSubprocess | null;
  }

  getByHash(hash: string): MCPSubprocess | null {
    return this.db.query('SELECT * FROM mcp_subprocesses WHERE config_hash = ?').get(hash) as MCPSubprocess | null;
  }

  getAll(): MCPSubprocess[] {
    return this.db.query('SELECT * FROM mcp_subprocesses').all() as MCPSubprocess[];
  }

  delete(id: string): void {
    this.db.run('DELETE FROM mcp_subprocesses WHERE id = ?', [id]);
  }
}
