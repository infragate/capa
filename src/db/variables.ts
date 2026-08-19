import type { Database } from "bun:sqlite";
import {
	decryptSecretString,
	encryptSecret,
} from "../shared/secret-crypto";

export class VariablesRepo {
	constructor(private db: Database) {}

	set(projectId: string, key: string, value: string): void {
		const now = Date.now();
		const stored = encryptSecret(value);
		this.db.run(
			`INSERT INTO variables (project_id, key, value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = ?, created_at = ?`,
			[projectId, key, stored, now, stored, now],
		);
	}

	get(projectId: string, key: string): string | null {
		const result = this.db
			.query("SELECT value FROM variables WHERE project_id = ? AND key = ?")
			.get(projectId, key) as { value: string } | null;
		return result ? decryptSecretString(result.value) : null;
	}

	getAll(projectId: string): Record<string, string> {
		const rows = this.db
			.query("SELECT key, value FROM variables WHERE project_id = ?")
			.all(projectId) as Array<{ key: string; value: string }>;

		const vars: Record<string, string> = {};
		for (const row of rows) {
			vars[row.key] = decryptSecretString(row.value);
		}
		return vars;
	}

	delete(projectId: string, key: string): void {
		this.db.run("DELETE FROM variables WHERE project_id = ? AND key = ?", [
			projectId,
			key,
		]);
	}
}
