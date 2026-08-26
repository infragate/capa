/**
 * Resolve auth/token endpoints from canonical camelCase fields, with legacy
 * alias fallbacks for session/DB oauth2 blocks that predate ingest normalization
 * (`tokenUrl` / `authorizationUrl`, snake_case, etc.).
 *
 * Accepts oauth2-shaped objects (capabilities config, discovery result, or
 * legacy session JSON) — callers may pass optional or required endpoint fields.
 */
export type OAuthEndpointResolvable = {
	authorizationEndpoint?: string;
	tokenEndpoint?: string;
	authorizationUrl?: string;
	tokenUrl?: string;
	authorization_endpoint?: string;
	token_endpoint?: string;
	authorization_url?: string;
	token_url?: string;
};

export function resolveAuthorizationEndpoint(
	oauth2Config: OAuthEndpointResolvable | null | undefined,
): string | undefined {
	if (oauth2Config == null || typeof oauth2Config !== "object") {
		return undefined;
	}
	return firstNonEmptyString(
		oauth2Config.authorizationEndpoint,
		oauth2Config.authorizationUrl,
		oauth2Config.authorization_endpoint,
		oauth2Config.authorization_url,
	);
}

export function resolveTokenEndpoint(
	oauth2Config: OAuthEndpointResolvable | null | undefined,
): string | undefined {
	if (oauth2Config == null || typeof oauth2Config !== "object") {
		return undefined;
	}
	return firstNonEmptyString(
		oauth2Config.tokenEndpoint,
		oauth2Config.tokenUrl,
		oauth2Config.token_endpoint,
		oauth2Config.token_url,
	);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}
