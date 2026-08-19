import type { Database } from "bun:sqlite";
import {
	approveGitHttpCredential,
	fillGitHttpCredential,
	gitHostForPlatform,
	rejectGitHttpCredential,
} from "../shared/git-credentials";
import {
	getGitProvider,
	getGitProviderByHost,
} from "../shared/git-providers/registry";
import type { GitIntegration } from "../types/database";

function overlayHelperToken(row: GitIntegration): GitIntegration {
	const host = gitHostForPlatform(row.platform, row.host);
	const token = host ? fillGitHttpCredential(host) : null;
	return {
		...row,
		access_token: token ?? "",
		refresh_token: null,
	};
}

export class GitIntegrationsRepo {
	constructor(private db: Database) {}

	get(platform: string, host: string | null = null): GitIntegration | null {
		const row = this.db
			.query(
				"SELECT * FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))",
			)
			.get(platform, host, host) as GitIntegration | null;
		return row ? overlayHelperToken(row) : null;
	}

	set(
		platform: "github" | "gitlab" | "github-enterprise" | "gitlab-self-managed",
		tokenData: {
			host?: string | null;
			access_token: string;
			refresh_token?: string | null;
			token_type?: string;
			expires_at?: number | null;
		},
	): void {
		const now = Date.now();
		const host = tokenData.host || null;
		const helperHost = gitHostForPlatform(platform, host);
		if (helperHost && tokenData.access_token.trim()) {
			approveGitHttpCredential(helperHost, tokenData.access_token);
		}

		const existing = this.db
			.query(
				"SELECT id FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))",
			)
			.get(platform, host, host) as { id: number } | null;

		if (existing) {
			this.db.run(
				`UPDATE git_integrations SET
          access_token = '',
          refresh_token = NULL,
          token_type = ?,
          expires_at = NULL,
          updated_at = ?
         WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))`,
				[tokenData.token_type || "Bearer", now, platform, host, host],
			);
		} else {
			this.db.run(
				`INSERT INTO git_integrations (platform, host, access_token, refresh_token, token_type, expires_at, created_at, updated_at)
         VALUES (?, ?, '', NULL, ?, NULL, ?, ?)`,
				[platform, host, tokenData.token_type || "Bearer", now, now],
			);
		}
	}

	delete(platform: string, host: string | null = null): void {
		const helperHost = gitHostForPlatform(platform, host);
		if (helperHost) rejectGitHttpCredential(helperHost);
		this.db.run(
			"DELETE FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))",
			[platform, host, host],
		);
	}

	getAll(): GitIntegration[] {
		return (
			this.db
				.query("SELECT * FROM git_integrations ORDER BY created_at DESC")
				.all() as GitIntegration[]
		).map(overlayHelperToken);
	}

	getOAuthToken(provider: string): GitIntegration | null {
		const platform = getGitProviderByHost(provider)?.id as
			| "github"
			| "gitlab"
			| undefined;
		if (!platform) {
			return null;
		}

		return this.get(platform, null);
	}

	setOAuthToken(
		provider: string,
		tokenData: {
			access_token: string;
			refresh_token?: string | null;
			token_type?: string;
			expires_at?: number | null;
		},
	): void {
		const platform = getGitProviderByHost(provider)?.id as
			| "github"
			| "gitlab"
			| undefined;
		if (!platform) {
			throw new Error(`Unknown provider: ${provider}`);
		}

		this.set(platform, tokenData);
	}

	getAllOAuthTokens(): Array<GitIntegration & { provider: string }> {
		const integrations = this.getAll();

		return integrations
			.filter((i) => getGitProvider(i.platform))
			.map((integration) => ({
				...integration,
				provider: getGitProvider(integration.platform)!.host,
			}));
	}
}
