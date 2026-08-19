// Git Integration Manager for GitHub and GitLab authentication
// Handles OAuth2 flows via cloud endpoint and Personal Access Token storage

import type { CapaDatabase } from "../db/database";
import {
	fillGitHttpCredential,
	gitHostForPlatform,
	hasGitHttpCredential,
} from "../shared/git-credentials";
import { getGitProvider } from "../shared/git-providers/registry";
import { logger } from "../shared/logger";
import { CAPA_CLOUD_OAUTH_URL } from "../shared/ui-urls";
import type { GitPATConfig, GitPlatform } from "../types/git-integration";
import { generateState } from "../utils/pkce";

export class GitIntegrationManager {
	private db: CapaDatabase;
	private logger = logger.child("GitIntegrationManager");
	private pendingFlows = new Map<
		string,
		{ platform: GitPlatform; timestamp: number }
	>();

	constructor(db: CapaDatabase) {
		this.db = db;
	}

	/**
	 * Check if a specific platform integration is configured and usable.
	 * Tokens live in the developer's git credential helper / `gh auth`, not capa.db.
	 */
	isConnected(platform: GitPlatform, host?: string): boolean {
		const helperHost = gitHostForPlatform(platform, host);
		if (helperHost && hasGitHttpCredential(helperHost)) return true;
		return this.hasUsableStoredToken(
			this.db.getGitIntegration(platform, host || null),
		);
	}

	private hasUsableStoredToken(
		integration: ReturnType<CapaDatabase["getGitIntegration"]>,
	): boolean {
		return !!integration?.access_token?.trim();
	}

	private isOAuthIntegration(platform: GitPlatform): boolean {
		return !!getGitProvider(platform);
	}

	private async integrationIsLive(
		integration: NonNullable<ReturnType<CapaDatabase["getGitIntegration"]>>,
	): Promise<boolean> {
		if (!this.hasUsableStoredToken(integration)) {
			return false;
		}

		const host = integration.host ?? undefined;

		// Self-hosted PATs must still authenticate against the host API.
		if (
			integration.platform === "github-enterprise" ||
			integration.platform === "gitlab-self-managed"
		) {
			return this.validatePAT(
				integration.platform,
				host,
				integration.access_token,
			);
		}

		// Cloud OAuth: expired without refresh is not "connected" for the UI.
		if (integration.expires_at && integration.expires_at < Date.now()) {
			if (integration.refresh_token && this.isOAuthIntegration(integration.platform)) {
				const refreshed = await this.refreshAccessToken(
					integration.platform,
					host,
				);
				if (refreshed) {
					const updated = this.db.getGitIntegration(
						integration.platform,
						integration.host,
					);
					return this.hasUsableStoredToken(updated);
				}
			}
			return false;
		}

		return true;
	}

	/**
	 * Get all configured integrations with live connection status.
	 */
	async getAllIntegrations() {
		const integrations = this.db.getAllGitIntegrations();

		const results = await Promise.all(
			integrations.map(async (integration) => ({
				platform: integration.platform,
				host: integration.host || undefined,
				displayName: this.getPlatformDisplayName(
					integration.platform,
					integration.host,
				),
				isConnected: await this.integrationIsLive(integration),
				expiresAt: integration.expires_at || undefined,
				usesOAuth: this.isOAuthIntegration(integration.platform),
			})),
		);

		return results;
	}

	/**
	 * Generate authorization URL for OAuth2 flow (via cloud)
	 * Returns the cloud OAuth endpoint URL that will handle the entire OAuth flow
	 */
	async generateAuthorizationUrl(
		platform: "github" | "gitlab",
		localRedirectUri: string,
	): Promise<{ url: string; flowId: string; state: string }> {
		const state = generateState();
		this.pendingFlows.set(state, {
			platform,
			timestamp: Date.now(),
		});
		this.cleanupExpiredFlows();

		const gp = getGitProvider(platform);
		if (!gp) {
			throw new Error(`Unknown git platform: ${platform}`);
		}

		const callback = new URL(localRedirectUri);
		callback.searchParams.set("state", state);
		callback.searchParams.set("flowId", state);

		const cloudUrl = new URL(CAPA_CLOUD_OAUTH_URL);
		cloudUrl.searchParams.set("provider", gp.cloudOAuthProviderParam);
		cloudUrl.searchParams.set("redirect", callback.toString());
		cloudUrl.searchParams.set("state", state);

		const finalUrl = cloudUrl.toString();
		this.logger.info(`Generated cloud OAuth URL for ${platform}: ${finalUrl}`);
		this.logger.debug(`OAuth state: ${state}, Redirect URI: ${callback}`);
		return { url: finalUrl, flowId: state, state };
	}

	/**
	 * Handle OAuth2 callback - receive access token from cloud
	 * The cloud OAuth handler already exchanged the code for a token
	 */
	async handleCallback(
		accessToken: string,
		state: string | undefined,
		refreshToken?: string,
		expiresIn?: number,
	): Promise<{ success: boolean; platform?: GitPlatform; error?: string }> {
		try {
			this.logger.info(
				`OAuth callback received. State present: ${Boolean(state)}, Token length: ${accessToken.length}`,
			);

			if (!state) {
				return { success: false, error: "Missing OAuth state" };
			}

			const flowData = this.pendingFlows.get(state);
			if (!flowData) {
				this.logger.warn("OAuth callback rejected: unknown or reused state");
				return { success: false, error: "Invalid or expired OAuth state" };
			}
			this.pendingFlows.delete(state);
			const platform = flowData.platform;

			// Calculate expiration timestamp
			const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

			// Store token in database
			this.db.setGitIntegration(platform, {
				access_token: accessToken,
				refresh_token: refreshToken || null,
				token_type: "Bearer",
				expires_at: expiresAt,
			});

			this.logger.success(
				`Token handed to git credential helper for ${platform}`,
			);
			return { success: true, platform };
		} catch (error: any) {
			this.logger.failure(`Callback error: ${error.message}`);
			return { success: false, error: error.message || "Token storage failed" };
		}
	}

	/**
	 * Test if a token is valid for a given platform
	 */
	private async testToken(
		platform: "github" | "gitlab",
		token: string,
	): Promise<boolean> {
		try {
			const gp = getGitProvider(platform);
			if (!gp) return false;

			const response = await fetch(gp.apiUserUrl, {
				headers: {
					Authorization: gp.authHeader(token),
					Accept: "application/json",
				},
			});

			return response.ok;
		} catch (error) {
			this.logger.debug(`Token test failed for ${platform}: ${error}`);
			return false;
		}
	}

	/**
	 * Store a Personal Access Token for cloud or self-hosted Git providers.
	 * Overwrites any existing credential for the platform/host (including OAuth).
	 */
	async storePAT(config: GitPATConfig): Promise<void> {
		const isSelfHosted =
			config.platform === "github-enterprise" ||
			config.platform === "gitlab-self-managed";

		if (isSelfHosted && !config.host) {
			throw new Error(
				`Host is required for ${config.platform} Personal Access Tokens.`,
			);
		}

		const hostLabel = config.host ?? "cloud";
		this.logger.info(`Storing PAT for ${config.platform} at ${hostLabel}`);

		const isValid = await this.validatePAT(
			config.platform,
			config.host,
			config.token,
		);

		if (!isValid) {
			throw new Error(
				"Invalid Personal Access Token. Please check your token and try again.",
			);
		}

		this.db.setGitIntegration(config.platform, {
			host: config.host ?? null,
			access_token: config.token,
			refresh_token: null,
			token_type: "token",
			expires_at: null,
		});

		this.logger.success(
			`PAT handed to git credential helper for ${config.platform} at ${hostLabel}`,
		);
	}

	/**
	 * Validate a Personal Access Token against the provider's user API.
	 */
	private async validatePAT(
		platform: GitPlatform,
		host: string | undefined,
		token: string,
	): Promise<boolean> {
		try {
			if (platform === "github" || platform === "gitlab") {
				return await this.testToken(platform, token);
			}

			if (!host) {
				return false;
			}

			const apiUrl =
				platform === "github-enterprise"
					? `https://${host}/api/v3/user`
					: `https://${host}/api/v4/user`;

			const authHeader =
				platform === "github-enterprise" ? `token ${token}` : `Bearer ${token}`;

			const response = await fetch(apiUrl, {
				headers: {
					Authorization: authHeader,
					Accept: "application/json",
				},
			});

			return response.ok;
		} catch (error) {
			this.logger.debug(`PAT validation failed: ${error}`);
			return false;
		}
	}

	/**
	 * Get access token for a platform from the git credential helper.
	 * CAPA does not persist git tokens, so there is nothing to refresh via
	 * capa.infragate.ai.
	 */
	async getAccessToken(
		platform: GitPlatform,
		host?: string,
	): Promise<string | null> {
		const helperHost = gitHostForPlatform(platform, host);
		if (helperHost) {
			const token = fillGitHttpCredential(helperHost);
			if (token) return token;
		}
		const integration = this.db.getGitIntegration(platform, host || null);
		return integration?.access_token?.trim() || null;
	}

	/**
	 * Git tokens are not stored in CAPA, so cloud refresh is a no-op.
	 */
	async refreshAccessToken(
		platform: GitPlatform,
		_host?: string,
	): Promise<boolean> {
		this.logger.info(
			`Skipping cloud git token refresh for ${platform}; credentials come from git/gh`,
		);
		return false;
	}

	/**
	 * Alias for `getAccessToken`.
	 */
	async getAccessTokenLegacy(
		platform: GitPlatform,
		host?: string,
	): Promise<string | null> {
		return this.getAccessToken(platform, host);
	}

	/**
	 * Get authentication headers for a platform
	 */
	async getAuthHeaders(
		platform: GitPlatform,
		host?: string,
	): Promise<Record<string, string> | null> {
		const token = await this.getAccessToken(platform, host);
		if (!token) {
			return null;
		}

		const gp = getGitProvider(platform);
		if (gp) {
			return {
				Authorization: gp.authHeader(token),
			};
		}

		// Self-managed instances
		if (platform === "github-enterprise") {
			return {
				Authorization: `token ${token}`,
			};
		}

		return {
			Authorization: `Bearer ${token}`,
		};
	}

	/**
	 * Disconnect an integration
	 */
	disconnect(platform: GitPlatform, host?: string): void {
		this.db.deleteGitIntegration(platform, host || null);
		this.logger.info(`Disconnected ${platform}${host ? ` at ${host}` : ""}`);
	}

	/**
	 * Get display name for a platform
	 */
	private getPlatformDisplayName(
		platform: GitPlatform,
		host: string | null,
	): string {
		const gp = getGitProvider(platform);
		if (gp && !host) {
			return gp.displayName;
		}

		switch (platform) {
			case "github-enterprise":
				return `GitHub Enterprise${host ? ` (${host})` : ""}`;
			case "gitlab-self-managed":
				return `GitLab Self-Managed${host ? ` (${host})` : ""}`;
			default:
				return getGitProvider(platform)?.displayName ?? platform;
		}
	}

	/**
	 * Clean up expired pending flows
	 */
	private cleanupExpiredFlows(): void {
		const cutoff = Date.now() - 15 * 60 * 1000; // 15 minutes
		const expiredFlows: string[] = [];

		for (const [flowId, flowData] of this.pendingFlows.entries()) {
			if (flowData.timestamp < cutoff) {
				this.pendingFlows.delete(flowId);
				expiredFlows.push(flowId);
			}
		}

		if (expiredFlows.length > 0) {
			this.logger.debug(
				`Cleaned up ${expiredFlows.length} expired OAuth flow(s)`,
			);
		}
	}
}
