import type { Database } from "bun:sqlite";
import {
	approveGitHttpCredential,
	gitHostForPlatform,
} from "../shared/git-credentials";
import { canonicalizeStoredSecret, decryptSecret } from "../shared/secret-crypto";
import {
	gitSecretBinding,
	oauthSecretBinding,
	variableSecretBinding,
} from "../shared/secret-binding";

function nextSecret(
	value: string | null,
	binding: Parameters<typeof canonicalizeStoredSecret>[1],
): { value: string | null; changed: boolean; corrupt?: boolean } {
	if (typeof value !== "string" || value.length === 0) {
		return { value, changed: false };
	}
	try {
		const next = canonicalizeStoredSecret(value, binding);
		return { value: next, changed: next !== value };
	} catch {
		return { value, changed: false, corrupt: true };
	}
}

/**
 * Encrypt leftover plaintext / v1 secret columns with v2+AAD.
 * Hand leftover git tokens to the OS git credential helper and wipe them
 * from SQLite. Safe to run on every open.
 */
export function migrateSecretsAtRest(db: Database): void {
	const tx = db.transaction(() => {
		for (const row of db
			.query("SELECT project_id, key, value FROM variables")
			.all() as Array<{ project_id: string; key: string; value: string }>) {
			const n = nextSecret(
				row.value,
				variableSecretBinding(row.project_id, row.key),
			);
			if (!n.changed) continue;
			db.run("UPDATE variables SET value = ? WHERE project_id = ? AND key = ?", [
				n.value,
				row.project_id,
				row.key,
			]);
		}

		for (const row of db
			.query("SELECT id, project_id, server_id, access_token, refresh_token FROM oauth_tokens")
			.all() as Array<{
			id: number;
			project_id: string;
			server_id: string;
			access_token: string;
			refresh_token: string | null;
		}>) {
			const access = nextSecret(
				row.access_token,
				oauthSecretBinding(row.project_id, row.server_id, "access_token"),
			);
			const refresh = nextSecret(
				row.refresh_token,
				oauthSecretBinding(row.project_id, row.server_id, "refresh_token"),
			);
			if (access.corrupt || refresh.corrupt) {
				db.run("DELETE FROM oauth_tokens WHERE id = ?", [row.id]);
				continue;
			}
			if (!access.changed && !refresh.changed) continue;
			db.run(
				"UPDATE oauth_tokens SET access_token = ?, refresh_token = ? WHERE id = ?",
				[access.value, refresh.value, row.id],
			);
		}

		for (const row of db
			.query(
				"SELECT id, platform, host, access_token, refresh_token FROM git_integrations",
			)
			.all() as Array<{
			id: number;
			platform: string;
			host: string | null;
			access_token: string;
			refresh_token: string | null;
		}>) {
			const accessPlain = decryptSecret(
				row.access_token,
				gitSecretBinding(row.platform, row.host, "access_token"),
			);
			const refreshPlain = decryptSecret(
				row.refresh_token,
				gitSecretBinding(row.platform, row.host, "refresh_token"),
			);
			const token = accessPlain?.trim() || refreshPlain?.trim();
			if (token) {
				const host = gitHostForPlatform(row.platform, row.host);
				if (host) approveGitHttpCredential(host, accessPlain?.trim() || token);
			}
			if (row.access_token !== "" || row.refresh_token != null) {
				db.run(
					"UPDATE git_integrations SET access_token = '', refresh_token = NULL WHERE id = ?",
					[row.id],
				);
			}
		}
	});
	tx();
}
