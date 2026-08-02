import type { OAuth2Config } from "../types/oauth";

/** Resolve auth/token endpoints from mixed plugin + discovery field names. */
export function resolveAuthorizationEndpoint(
	oauth2Config: OAuth2Config,
): string | undefined {
	return (
		oauth2Config.authorizationEndpoint ||
		(oauth2Config as { authorizationUrl?: string }).authorizationUrl
	);
}

export function resolveTokenEndpoint(
	oauth2Config: OAuth2Config,
): string | undefined {
	return (
		oauth2Config.tokenEndpoint ||
		(oauth2Config as { tokenUrl?: string }).tokenUrl
	);
}
