/**
 * Resolve auth/token endpoints from canonical camelCase fields, with legacy
 * alias fallbacks for session/DB oauth2 blocks that predate ingest normalization
 * (`tokenUrl` / `authorizationUrl`, snake_case, etc.).
 *
 * Accepts any oauth2-shaped object (capabilities config, discovery result, or
 * legacy session JSON) — callers may pass optional or required endpoint fields.
 */
export function resolveAuthorizationEndpoint(
	oauth2Config: object,
): string | undefined {
	const cfg = oauth2Config as Record<string, unknown>;
	return firstNonEmptyString(
		cfg.authorizationEndpoint,
		cfg.authorizationUrl,
		cfg.authorization_endpoint,
		cfg.authorization_url,
	);
}

export function resolveTokenEndpoint(oauth2Config: object): string | undefined {
	const cfg = oauth2Config as Record<string, unknown>;
	return firstNonEmptyString(
		cfg.tokenEndpoint,
		cfg.tokenUrl,
		cfg.token_endpoint,
		cfg.token_url,
	);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}
