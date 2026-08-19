import type { Database } from "bun:sqlite";
import { canonicalizeStoredSecret } from "../shared/secret-crypto";

function nextSecret(value: string | null): { value: string | null; changed: boolean } {
	if (typeof value !== "string" || value.length === 0) {
		return { value, changed: false };
	}
	const next = canonicalizeStoredSecret(value);
	return { value: next, changed: next !== value };
}

/** Encrypt legacy plaintext secret columns. Safe to run on every open. */
export function migrateSecretsAtRest(db: Database): void {
	const tx = db.transaction(() => {
		for (const row of db
			.query("SELECT project_id, key, value FROM variables")
			.all() as Array<{ project_id: string; key: string; value: string }>) {
			const n = nextSecret(row.value);
			if (!n.changed) continue;
			db.run("UPDATE variables SET value = ? WHERE project_id = ? AND key = ?", [
				n.value,
				row.project_id,
				row.key,
			]);
		}

		for (const row of db
			.query(
				"SELECT id, access_token, refresh_token FROM oauth_tokens",
			)
			.all() as Array<{
			id: number;
			access_token: string;
			refresh_token: string | null;
		}>) {
			const access = nextSecret(row.access_token);
			const refresh = nextSecret(row.refresh_token);
			if (!access.changed && !refresh.changed) continue;
			db.run(
				"UPDATE oauth_tokens SET access_token = ?, refresh_token = ? WHERE id = ?",
				[access.value, refresh.value, row.id],
			);
		}

		for (const row of db
			.query(
				"SELECT id, access_token, refresh_token FROM git_integrations",
			)
			.all() as Array<{
			id: number;
			access_token: string;
			refresh_token: string | null;
		}>) {
			const access = nextSecret(row.access_token);
			const refresh = nextSecret(row.refresh_token);
			if (!access.changed && !refresh.changed) continue;
			db.run(
				"UPDATE git_integrations SET access_token = ?, refresh_token = ? WHERE id = ?",
				[access.value, refresh.value, row.id],
			);
		}
	});
	tx();
}
