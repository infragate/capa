// Git Integration Manager for GitHub and GitLab authentication
// Handles OAuth2 flows via cloud endpoint and Personal Access Token storage

import type { CapaDatabase } from "../db/database";
import { getGitProvider } from "../shared/git-providers/registry";
import { logger } from "../shared/logger";
import { isPermanentRefreshFailure } from "../shared/oauth-refresh";
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
	 * Check if a specific platform integration is configured
	 */
	isConnected(platform: GitPlatform, host?: string): boolean {
		const integration = this.db.getGitIntegration(platform, host || null);
		return !!integration;
	}

	/**
	 * Get all configured integrations
	 */
	getAllIntegrations() {
		const integrations = this.db.getAllGitIntegrations();

		return integrations.map((integration) => ({
			platform: integration.platform,
			host: integration.host || undefined,
			displayName: this.getPlatformDisplayName(
				integration.platform,
				integration.host,
			),
			isConnected: true,
			expiresAt: integration.expires_at || undefined,
			usesOAuth: !!getGitProvider(integration.platform),
		}));
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
				`Token stored for ${platform}${refreshToken ? " (with refresh token)" : ""}`,
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

		this.logger.success(`PAT stored for ${config.platform} at ${hostLabel}`);
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
	 * Get access token for a platform
	 * Automatically refreshes expired tokens if refresh token is available
	 */
	async getAccessToken(
		platform: GitPlatform,
		host?: string,
	): Promise<string | null> {
		const integration = this.db.getGitIntegration(platform, host || null);
		if (!integration) {
			return null;
		}

		// Check if token is expired or expiring soon (within 5 minutes)
		if (integration.expires_at) {
			const expiresIn = integration.expires_at - Date.now();
			const fiveMinutes = 5 * 60 * 1000;

			if (expiresIn < fiveMinutes) {
				this.logger.info(
					`Token for ${platform} expired or expiring soon, attempting refresh...`,
				);

				// Try to refresh if we have a refresh token
				if (integration.refresh_token) {
					const refreshed = await this.refreshAccessToken(platform, host);
					if (refreshed) {
						// Get the refreshed token
						const updatedIntegration = this.db.getGitIntegration(
							platform,
							host || null,
						);
						return updatedIntegration?.access_token || null;
					} else {
						this.logger.warn(`Failed to refresh token for ${platform}`);
						// Return expired token and let the caller handle 401
						return integration.access_token;
					}
				} else {
					this.logger.warn(`No refresh token available for ${platform}`);
					// Return expired token and let the caller handle 401
					return integration.access_token;
				}
			}
		}

		return integration.access_token;
	}

	/**
	 * Refresh access token using refresh token via cloud OAuth proxy (POST + JSON body).
	 *
	 * POST https://capa.infragate.ai/auth/refresh
	 * Body: { "provider": "github.com", "refresh_token": "..." }
	 */
	async refreshAccessToken(
		platform: GitPlatform,
		host?: string,
	): Promise<boolean> {
		try {
			const integration = this.db.getGitIntegration(platform, host || null);

			if (!integration || !integration.refresh_token) {
				this.logger.failure(`No refresh token available for ${platform}`);
				return false;
			}

			// Only registered cloud OAuth providers support refresh
			const gp = getGitProvider(platform);
			if (!gp) {
				this.logger.warn(`Refresh not supported for ${platform}`);
				return false;
			}

			this.logger.debug(
				`Refreshing token via: ${CAPA_CLOUD_OAUTH_URL}/refresh`,
			);

			const response = await fetch(`${CAPA_CLOUD_OAUTH_URL}/refresh`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: gp.cloudOAuthProviderParam,
					refresh_token: integration.refresh_token,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.failure(
					`Token refresh failed: ${response.status} ${errorText}`,
				);

				// Only delete the stored token when the refresh_token itself is known to be
				// unusable (invalid_grant / invalid_token / expired). Transient failures like
				// proxy 5xx, rate limits, or network blips keep the token so the next
				// scheduler tick (or user retry) can succeed.
				if (isPermanentRefreshFailure(undefined, response, errorText)) {
					this.db.deleteGitIntegration(platform, host || null);
					this.logger.info(`Deleted invalid token for ${platform}`);
				} else {
					this.logger.warn(
						`Transient refresh failure for ${platform}, keeping token`,
					);
				}
				return false;
			}

			const tokenData = await response.json();

			if (!tokenData.access_token) {
				this.logger.failure("No access token in refresh response");
				return false;
			}

			// Calculate expiration
			const expiresAt = tokenData.expires_in
				? Date.now() + tokenData.expires_in * 1000
				: null;

			// Update token in database
			this.db.setGitIntegration(platform, {
				host: host || null,
				access_token: tokenData.access_token,
				refresh_token: tokenData.refresh_token || integration.refresh_token, // Use new or keep old
				token_type: tokenData.token_type || "Bearer",
				expires_at: expiresAt,
			});

			this.logger.success(`Token refreshed successfully for ${platform}`);
			return true;
		} catch (error: any) {
			this.logger.failure(`Token refresh error: ${error.message}`);
			return false;
		}
	}

	/**
	 * Alias for `getAccessToken` (automatically refreshes when needed).
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
