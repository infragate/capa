import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { isPermanentRefreshFailure } from "../shared/oauth-refresh";
import type { OAuth2Config } from "../types/oauth";
import { resolveTokenEndpoint } from "./oauth-endpoint-resolve";

const tokenLogger = logger.child("OAuth2TokenStore");

function resolveStoredClientId(
	projectId: string,
	serverId: string,
	oauth2Config: OAuth2Config,
	db: CapaDatabase,
): string {
	return (
		db.getVariable(projectId, `oauth2_client_id_${serverId}`) ||
		oauth2Config.client_id ||
		oauth2Config.clientId ||
		oauth2Config.oauth?.clientId ||
		"capa"
	);
}

function parseRefreshTokenResponse(raw: unknown): {
	accessToken?: string;
	refreshToken?: string;
	tokenType?: string;
	expiresIn?: number;
	scope?: string;
	error?: string;
} {
	return parseOAuthTokenExchangeResponse(raw);
}

/** Shared parser for OAuth token endpoint JSON (exchange + refresh). */
export function parseOAuthTokenExchangeResponse(raw: unknown): {
	accessToken?: string;
	refreshToken?: string;
	tokenType?: string;
	expiresIn?: number;
	scope?: string;
	error?: string;
} {
	if (!raw || typeof raw !== "object") {
		return { error: "Token response was not a JSON object" };
	}
	const body = raw as Record<string, unknown>;
	if (body.ok === false && typeof body.error === "string") {
		return { error: body.error };
	}
	if (typeof body.error === "string") {
		return { error: body.error };
	}
	const accessToken =
		typeof body.access_token === "string" ? body.access_token : undefined;
	const refreshToken =
		typeof body.refresh_token === "string" ? body.refresh_token : undefined;
	const tokenType =
		typeof body.token_type === "string" ? body.token_type : undefined;
	const scope = typeof body.scope === "string" ? body.scope : undefined;
	const expiresInRaw = body.expires_in;
	const expiresIn =
		typeof expiresInRaw === "number"
			? expiresInRaw
			: typeof expiresInRaw === "string"
				? Number(expiresInRaw)
				: undefined;
	if (!accessToken) {
		return { error: "Token response did not include access_token" };
	}
	return { accessToken, refreshToken, tokenType, scope, expiresIn };
}

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

		const clientId = resolveStoredClientId(
			projectId,
			serverId,
			oauth2Config,
			db,
		);
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

		const parsed = parseRefreshTokenResponse(await response.json());
		if (parsed.error || !parsed.accessToken) {
			const message = parsed.error || "Token response did not include access_token";
			log.failure(`Token refresh failed: ${message}`);
			if (
				isPermanentRefreshFailure(undefined, response, message) ||
				/invalid|expired|revoked|not_found|unauthorized/i.test(message)
			) {
				db.deleteOAuthToken(projectId, serverId);
				log.info(`Deleted invalid token for ${serverId}`);
			} else {
				log.warn(`Transient refresh failure for ${serverId}, keeping token`);
			}
			return false;
		}

		const expiresAt =
			parsed.expiresIn && Number.isFinite(parsed.expiresIn)
				? Date.now() + parsed.expiresIn * 1000
				: undefined;

		db.setOAuthToken(projectId, serverId, {
			access_token: parsed.accessToken,
			refresh_token: parsed.refreshToken || tokenData.refresh_token,
			token_type: parsed.tokenType || "Bearer",
			expires_at: expiresAt,
			scope: parsed.scope || tokenData.scope,
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
