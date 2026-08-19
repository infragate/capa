import type { Database } from "bun:sqlite";
import {
	decryptSecret,
	decryptSecretString,
	encryptSecret,
} from "../shared/secret-crypto";
import { oauthSecretBinding } from "../shared/secret-binding";
import type { OAuthTokenRow } from "../types/database";

function decryptTokenRow(row: OAuthTokenRow): OAuthTokenRow {
	const access_token = decryptSecretString(
		row.access_token,
		oauthSecretBinding(row.project_id, row.server_id, "access_token"),
	);
	let refresh_token: string | null = null;
	if (row.refresh_token != null) {
		const plain = decryptSecret(
			row.refresh_token,
			oauthSecretBinding(row.project_id, row.server_id, "refresh_token"),
		);
		if (plain === null) {
			throw new Error(
				`Failed to decrypt OAuth refresh token for ${row.server_id}`,
			);
		}
		refresh_token = plain;
	}
	return { ...row, access_token, refresh_token };
}

export class OAuthTokensRepo {
	constructor(private db: Database) {}

	get(projectId: string, serverId: string): OAuthTokenRow | null {
		const row = this.db
			.query(
				"SELECT * FROM oauth_tokens WHERE project_id = ? AND server_id = ?",
			)
			.get(projectId, serverId) as OAuthTokenRow | null;
		if (!row) return null;
		try {
			return decryptTokenRow(row);
		} catch {
			// Undecryptable row (master key rotation, corrupt blob) — drop it so
			// refresh loops stop and the UI can prompt for reconnect.
			this.delete(projectId, serverId);
			return null;
		}
	}

	set(
		projectId: string,
		serverId: string,
		tokenData: {
			access_token: string;
			refresh_token?: string;
			token_type?: string;
			expires_at?: number;
			scope?: string;
		},
	): void {
		if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
			throw new Error("OAuth access_token is required");
		}
		const now = Date.now();
		const access = encryptSecret(
			tokenData.access_token,
			oauthSecretBinding(projectId, serverId, "access_token"),
		);
		const refresh =
			typeof tokenData.refresh_token === "string" && tokenData.refresh_token
				? encryptSecret(
						tokenData.refresh_token,
						oauthSecretBinding(projectId, serverId, "refresh_token"),
					)
				: null;
		this.db.run(
			`INSERT INTO oauth_tokens (project_id, server_id, access_token, refresh_token, token_type, expires_at, scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, server_id) DO UPDATE SET
         access_token = ?,
         refresh_token = ?,
         token_type = ?,
         expires_at = ?,
         scope = ?,
         updated_at = ?`,
			[
				projectId,
				serverId,
				access,
				refresh,
				tokenData.token_type || "Bearer",
				tokenData.expires_at || null,
				tokenData.scope || null,
				now,
				now,
				access,
				refresh,
				tokenData.token_type || "Bearer",
				tokenData.expires_at || null,
				tokenData.scope || null,
				now,
			],
		);
	}

	delete(projectId: string, serverId: string): void {
		this.db.run(
			"DELETE FROM oauth_tokens WHERE project_id = ? AND server_id = ?",
			[projectId, serverId],
		);
	}

	getAll(projectId: string): OAuthTokenRow[] {
		const rows = this.db
			.query("SELECT * FROM oauth_tokens WHERE project_id = ?")
			.all(projectId) as OAuthTokenRow[];
		const out: OAuthTokenRow[] = [];
		for (const row of rows) {
			try {
				out.push(decryptTokenRow(row));
			} catch {
				this.delete(row.project_id, row.server_id);
			}
		}
		return out;
	}
}
