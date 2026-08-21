import type { OAuth2Config } from "../types/oauth";

/** Canonical camelCase fields only — aliases are stripped at ingest. */
export function resolveAuthorizationEndpoint(
	oauth2Config: OAuth2Config,
): string | undefined {
	return oauth2Config.authorizationEndpoint;
}

export function resolveTokenEndpoint(
	oauth2Config: OAuth2Config,
): string | undefined {
	return oauth2Config.tokenEndpoint;
}
