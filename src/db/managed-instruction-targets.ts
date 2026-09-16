import type { Database } from "bun:sqlite";

/**
 * Instruction files outside the providers' root filenames that capa wrote
 * rule blocks into (nested `dir/AGENTS.md`, isolated `GEMINI.md`). Used by
 * prune/clean to find blocks after a rule's scope changes.
 */
export class ManagedInstructionTargetsRepo {
	constructor(private db: Database) {}

	add(projectId: string, filePath: string): void {
		this.db.run(
			`INSERT OR IGNORE INTO managed_instruction_targets (project_id, file_path, created_at)
       VALUES (?, ?, ?)`,
			[projectId, filePath, Date.now()],
		);
	}

	getAll(projectId: string): string[] {
		const rows = this.db
			.query(
				"SELECT file_path FROM managed_instruction_targets WHERE project_id = ? ORDER BY file_path",
			)
			.all(projectId) as Array<{ file_path: string }>;
		return rows.map((r) => r.file_path);
	}

	remove(projectId: string, filePath: string): void {
		this.db.run(
			"DELETE FROM managed_instruction_targets WHERE project_id = ? AND file_path = ?",
			[projectId, filePath],
		);
	}

	clear(projectId: string): void {
		this.db.run(
			"DELETE FROM managed_instruction_targets WHERE project_id = ?",
			[projectId],
		);
	}
}
