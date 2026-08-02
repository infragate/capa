import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { isPermanentRefreshFailure } from "../shared/oauth-refresh";
import type { OAuth2Config } from "../types/oauth";
import { resolveTokenEndpoint } from "./oauth-endpoint-resolve";

const tokenLogger = logger.child("OAuth2TokenStore");

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
	db: CapaDatabase,
	projectId: string,
	serverId: string,
	oauth2Config: OAuth2Config,
	log = tokenLogger,
): Promise<boolean> {
	try {
		const tokenData = db.getOAuthToken(projectId, serverId);
		if (!tokenData || !tokenData.refresh_token) {
			log.failure(`No refresh token available for ${serverId}`);
			if (tokenData) {
				db.deleteOAuthToken(projectId, serverId);
				log.info(`Deleted incomplete token for ${serverId}`);
			}
			return false;
		}

		log.info(`Refreshing access token for ${serverId}`);

		const clientId =
			db.getVariable(projectId, `oauth2_client_id_${serverId}`) || "capa";
		const clientSecret = db.getVariable(
			projectId,
			`oauth2_client_secret_${serverId}`,
		);

		const tokenParams: Record<string, string> = {
			grant_type: "refresh_token",
			refresh_token: tokenData.refresh_token,
			client_id: clientId,
		};

		if (clientSecret) {
			tokenParams.client_secret = clientSecret;
		}

		const tokenEndpoint = resolveTokenEndpoint(oauth2Config);
		if (!tokenEndpoint) {
			log.failure(`No token endpoint for ${serverId}`);
			return false;
		}

		const response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams(tokenParams).toString(),
		});

		if (!response.ok) {
			const body = await response.text();
			log.failure(
				`Token refresh failed: ${response.status} ${response.statusText}`,
			);
			if (isPermanentRefreshFailure(undefined, response, body)) {
				db.deleteOAuthToken(projectId, serverId);
				log.info(`Deleted invalid token for ${serverId}`);
			} else {
				log.warn(`Transient refresh failure for ${serverId}, keeping token`);
			}
			return false;
		}

		const newTokenData = await response.json();

		const expiresAt = newTokenData.expires_in
			? Date.now() + newTokenData.expires_in * 1000
			: undefined;

		db.setOAuthToken(projectId, serverId, {
			access_token: newTokenData.access_token,
			refresh_token: newTokenData.refresh_token || tokenData.refresh_token,
			token_type: newTokenData.token_type || "Bearer",
			expires_at: expiresAt,
			scope: newTokenData.scope || tokenData.scope,
		});

		log.success(`Access token refreshed for ${serverId}`);
		return true;
	} catch (error: any) {
		log.failure(`Token refresh error: ${error.message}`);
		if (isPermanentRefreshFailure(error)) {
			db.deleteOAuthToken(projectId, serverId);
			log.info(`Deleted failed token for ${serverId}`);
		} else {
			log.warn(`Transient refresh error for ${serverId}, keeping token`);
		}
		return false;
	}
}

/**
 * Get access token for a server (with automatic refresh if expired)
 */
export async function getAccessToken(
	db: CapaDatabase,
	projectId: string,
	serverId: string,
	oauth2Config: OAuth2Config,
	log = tokenLogger,
): Promise<string | null> {
	const tokenData = db.getOAuthToken(projectId, serverId);
	if (!tokenData) {
		return null;
	}

	if (tokenData.expires_at) {
		const expiresIn = tokenData.expires_at - Date.now();
		if (expiresIn < 5 * 60 * 1000) {
			log.info("Token expired or expiring soon, refreshing...");
			const refreshed = await refreshAccessToken(
				db,
				projectId,
				serverId,
				oauth2Config,
				log,
			);
			if (!refreshed) {
				return null;
			}
			const updatedToken = db.getOAuthToken(projectId, serverId);
			return updatedToken?.access_token || null;
		}
	}

	return tokenData.access_token;
}

/**
 * Check if a server has valid OAuth2 credentials
 */
export function isServerConnected(
	db: CapaDatabase,
	projectId: string,
	serverId: string,
): boolean {
	const tokenData = db.getOAuthToken(projectId, serverId);
	return !!tokenData;
}

/**
 * Disconnect OAuth2 connection (delete tokens)
 */
export function disconnect(
	db: CapaDatabase,
	projectId: string,
	serverId: string,
	log = tokenLogger,
): void {
	db.deleteOAuthToken(projectId, serverId);
	log.info(`Disconnected ${serverId}`);
}
