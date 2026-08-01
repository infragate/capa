// OAuth2 Manager for MCP servers
// Implements OAuth 2.1 with PKCE following the MCP Authorization specification
// https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { isPermanentRefreshFailure } from "../shared/oauth-refresh";
import type { OAuth2Config } from "../types/oauth";
import { detectOAuth2Requirement } from "./oauth-discovery";
import { generateAuthorizationUrl, handleCallback } from "./oauth-pkce-flow";
import {
	disconnect,
	getAccessToken,
	isServerConnected,
	refreshAccessToken,
} from "./oauth-token-store";

// Re-exported for backwards compatibility with existing import sites.
export { isPermanentRefreshFailure };

export class OAuth2Manager {
	private db: CapaDatabase;
	private oauth2ConfigCache = new Map<string, OAuth2Config>();
	private capabilitiesProvider?: () => Map<string, any>;
	private log = logger.child("OAuth2Manager");

	constructor(db: CapaDatabase) {
		this.db = db;
	}

	/**
	 * Set the capabilities provider function (called from server initialization)
	 */
	setCapabilitiesProvider(provider: () => Map<string, any>): void {
		this.capabilitiesProvider = provider;
	}

	/**
	 * Detect if an MCP server requires OAuth2 authentication
	 */
	async detectOAuth2Requirement(
		serverUrl: string,
		options?: { tlsSkipVerify?: boolean },
	): Promise<OAuth2Config | null> {
		const config = await detectOAuth2Requirement(serverUrl, options, this.log);
		if (config) {
			this.oauth2ConfigCache.set(serverUrl, config);
		}
		return config;
	}

	/**
	 * Generate authorization URL for OAuth2 flow with PKCE
	 */
	async generateAuthorizationUrl(
		projectId: string,
		serverId: string,
		oauth2Config: OAuth2Config,
		redirectUri: string,
	): Promise<{ url: string; state: string }> {
		return generateAuthorizationUrl(
			this.db,
			projectId,
			serverId,
			oauth2Config,
			redirectUri,
			this.log,
		);
	}

	/**
	 * Handle OAuth2 callback - exchange authorization code for tokens
	 */
	async handleCallback(
		code: string,
		state: string,
	): Promise<{
		success: boolean;
		projectId?: string;
		serverId?: string;
		error?: string;
	}> {
		return handleCallback(
			this.db,
			code,
			state,
			this.capabilitiesProvider,
			this.log,
		);
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(
		projectId: string,
		serverId: string,
		oauth2Config: OAuth2Config,
	): Promise<boolean> {
		return refreshAccessToken(
			this.db,
			projectId,
			serverId,
			oauth2Config,
			this.log,
		);
	}

	/**
	 * Get access token for a server (with automatic refresh if expired)
	 */
	async getAccessToken(
		projectId: string,
		serverId: string,
		oauth2Config: OAuth2Config,
	): Promise<string | null> {
		return getAccessToken(this.db, projectId, serverId, oauth2Config, this.log);
	}

	/**
	 * Check if a server has valid OAuth2 credentials
	 */
	isServerConnected(projectId: string, serverId: string): boolean {
		return isServerConnected(this.db, projectId, serverId);
	}

	/**
	 * Disconnect OAuth2 connection (delete tokens)
	 */
	disconnect(projectId: string, serverId: string): void {
		disconnect(this.db, projectId, serverId, this.log);
	}

	/**
	 * Helper to get project capabilities
	 */
	private async getProjectCapabilities(projectId: string): Promise<any> {
		if (!this.capabilitiesProvider) {
			return null;
		}
		const capabilities = this.capabilitiesProvider();
		return capabilities.get(projectId) || null;
	}
}
