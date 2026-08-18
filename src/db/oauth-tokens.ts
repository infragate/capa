import type { Database } from "bun:sqlite";
import {
	decryptSecret,
	decryptSecretString,
	encryptSecret,
} from "../shared/secret-crypto";
import type { OAuthTokenRow } from "../types/database";

function decryptTokenRow(row: OAuthTokenRow | null): OAuthTokenRow | null {
	if (!row) return null;
	return {
		...row,
		access_token: decryptSecretString(row.access_token),
		refresh_token:
			row.refresh_token == null
				? row.refresh_token
				: decryptSecret(row.refresh_token),
	};
}

export class OAuthTokensRepo {
	constructor(private db: Database) {}

	get(projectId: string, serverId: string): OAuthTokenRow | null {
		return decryptTokenRow(
			this.db
				.query(
					"SELECT * FROM oauth_tokens WHERE project_id = ? AND server_id = ?",
				)
				.get(projectId, serverId) as OAuthTokenRow | null,
		);
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
		const now = Date.now();
		const access = encryptSecret(tokenData.access_token);
		const refresh = tokenData.refresh_token
			? encryptSecret(tokenData.refresh_token)
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
		return (
			this.db
				.query("SELECT * FROM oauth_tokens WHERE project_id = ?")
				.all(projectId) as OAuthTokenRow[]
		).map((row) => decryptTokenRow(row)!);
	}
}
