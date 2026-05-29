import type { Database } from "bun:sqlite";

export interface ManagedHookRow {
  /** capa project id (matches `projects.id`). */
  projectId: string;
  /** Provider id from the registry (e.g. 'cursor', 'claude-code'). */
  providerId: string;
  /** Hook id from the capabilities file (matches `Hook.id`). */
  hookId: string;
  /** Absolute path of the provider's hook config file capa edited. */
  configPath: string;
  /**
   * JSON-encoded array describing where the entry sits inside the provider's
   * hooks-root. Layout is shape-specific; see
   * `shared/providers/hook-handlers.ts → HookLocator`.
   */
  locator: string;
  /** Absolute path of the materialised script body, when capa wrote one. */
  scriptPath: string | null;
  /** Created-at timestamp (ms since epoch). */
  createdAt: number;
}

interface ManagedHookSqlRow {
  project_id: string;
  provider_id: string;
  hook_id: string;
  config_path: string;
  locator: string;
  script_path: string | null;
  created_at: number;
}

function fromSql(row: ManagedHookSqlRow): ManagedHookRow {
  return {
    projectId: row.project_id,
    providerId: row.provider_id,
    hookId: row.hook_id,
    configPath: row.config_path,
    locator: row.locator,
    scriptPath: row.script_path,
    createdAt: row.created_at,
  };
}

export class ManagedHooksRepo {
  constructor(private db: Database) {}

  upsert(input: Omit<ManagedHookRow, "createdAt">): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO managed_hooks
         (project_id, provider_id, hook_id, config_path, locator, script_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, provider_id, hook_id) DO UPDATE SET
         config_path = excluded.config_path,
         locator     = excluded.locator,
         script_path = excluded.script_path`,
      [
        input.projectId,
        input.providerId,
        input.hookId,
        input.configPath,
        input.locator,
        input.scriptPath,
        now,
      ],
    );
  }

  getAll(projectId: string): ManagedHookRow[] {
    const rows = this.db
      .query(
        `SELECT project_id, provider_id, hook_id, config_path, locator, script_path, created_at
         FROM managed_hooks
         WHERE project_id = ?
         ORDER BY provider_id, hook_id`,
      )
      .all(projectId) as ManagedHookSqlRow[];
    return rows.map(fromSql);
  }

  remove(projectId: string, providerId: string, hookId: string): void {
    this.db.run(
      `DELETE FROM managed_hooks
       WHERE project_id = ? AND provider_id = ? AND hook_id = ?`,
      [projectId, providerId, hookId],
    );
  }

  /** Drop every entry for the project (used by `capa clean`). */
  clear(projectId: string): void {
    this.db.run("DELETE FROM managed_hooks WHERE project_id = ?", [projectId]);
  }
}
