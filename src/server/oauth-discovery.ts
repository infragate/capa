import { logger } from "../shared/logger";
import { shouldSkipTlsVerify } from "../shared/tls-skip-verify";
import type {
	OAuth2Config,
	OAuth2Metadata,
	ProtectedResourceMetadata,
} from "../types/oauth";

/** Timeout for outbound HTTP requests made during OAuth2 detection (ms). */
const OAUTH_DETECT_TIMEOUT_MS = 10_000;

function tlsFetchOptions(tlsSkipVerify?: boolean): object {
	return tlsSkipVerify ? { tls: { rejectUnauthorized: false } } : {};
}

/**
 * Fetch protected resource metadata (RFC 9728)
 * Default path: /.well-known/oauth-protected-resource
 */
export async function fetchProtectedResourceMetadata(
	url: string,
	tlsSkipVerify?: boolean,
): Promise<ProtectedResourceMetadata | null> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(OAUTH_DETECT_TIMEOUT_MS),
			...tlsFetchOptions(tlsSkipVerify),
		} as RequestInit);
		if (!response.ok) {
			return null;
		}
		return await response.json();
	} catch (error) {
		return null;
	}
}

/**
 * Build the RFC 8414 authorization-server metadata URL for an issuer.
 * Path-based issuers (e.g. Keycloak `/realms/{realm}`) must insert
 * `/.well-known/oauth-authorization-server` between host and path — not at origin root.
 */
export function buildOAuthAuthorizationServerMetadataUrl(
	authServerUrl: string,
): string {
	const issuer = new URL(authServerUrl);
	const path = issuer.pathname.replace(/\/$/, "");
	if (!path || path === "/") {
		return `${issuer.origin}/.well-known/oauth-authorization-server`;
	}
	return `${issuer.origin}/.well-known/oauth-authorization-server${path}`;
}

/**
 * Fetch authorization server metadata (RFC 8414)
 * Path: /.well-known/oauth-authorization-server
 */
export async function fetchAuthServerMetadata(
	authServerUrl: string,
	tlsSkipVerify?: boolean,
	log = logger.child("OAuth2Discovery"),
): Promise<OAuth2Metadata | null> {
	try {
		const wellKnownUrl = buildOAuthAuthorizationServerMetadataUrl(authServerUrl);

		log.debug(`Fetching OAuth metadata from: ${wellKnownUrl}`);
		const response = await fetch(wellKnownUrl, {
			signal: AbortSignal.timeout(OAUTH_DETECT_TIMEOUT_MS),
			...tlsFetchOptions(tlsSkipVerify),
		} as RequestInit);
		if (!response.ok) {
			log.warn(`OAuth metadata fetch failed: ${response.status}`);
			return null;
		}
		const metadata = await response.json();
		log.debug("OAuth metadata fetched");
		log.debug(`Authorization: ${metadata.authorization_endpoint}`);
		log.debug(`Token: ${metadata.token_endpoint}`);
		return metadata;
	} catch (error: any) {
		log.debug(`OAuth metadata fetch error: ${error.message}`);
		return null;
	}
}

/** Scopes commonly listed by Keycloak but not valid for user-facing authorization_code + DCR clients. */
export const BLOCKED_OAUTH_SCOPES = new Set([
	"service_account",
	"roles",
	"web-origins",
]);

/** Remove invalid scopes from a persisted or user-supplied scope string. */
export function sanitizeOAuthScope(scope: string): string {
	return scope
		.split(/\s+/)
		.filter((part) => part.length > 0 && !BLOCKED_OAUTH_SCOPES.has(part))
		.join(" ");
}

/** Prefer resource-advertised scopes; auth-server catalogs often list realm-wide scopes DCR clients cannot request. */
export function resolveOAuthScope(options: {
	resourceMetadata?: ProtectedResourceMetadata | null;
	wwwAuthenticateScope?: string | null;
	authServerScopes?: string[] | null;
}): string | undefined {
	if (options.resourceMetadata?.scopes_supported?.length) {
		return options.resourceMetadata.scopes_supported.join(" ");
	}
	if (options.wwwAuthenticateScope?.trim()) {
		return options.wwwAuthenticateScope.trim();
	}
	if (options.authServerScopes?.length) {
		const filtered = options.authServerScopes.filter(
			(s) => !BLOCKED_OAUTH_SCOPES.has(s),
		);
		if (filtered.length > 0) {
			return filtered.join(" ");
		}
	}
	return undefined;
}

/**
 * Detect if an MCP server requires OAuth2 authentication.
 * Per MCP spec: Make unauthenticated request, check for 401 + WWW-Authenticate header.
 */
export async function detectOAuth2Requirement(
	serverUrl: string,
	options?: { tlsSkipVerify?: boolean },
	log = logger.child("OAuth2Discovery"),
): Promise<OAuth2Config | null> {
	const tlsSkipVerify = shouldSkipTlsVerify(
		!!options?.tlsSkipVerify,
		`OAuth2 detection (${serverUrl})`,
	);
	try {
		log.info(`Detecting OAuth2 requirement for: ${serverUrl}`);

		const response = await fetch(serverUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "capa-oauth-detection", version: "1.0.0" },
				},
			}),
			signal: AbortSignal.timeout(OAUTH_DETECT_TIMEOUT_MS),
			...tlsFetchOptions(tlsSkipVerify),
		} as RequestInit);

		if (response.status !== 401) {
			log.debug(`No OAuth2 required (status: ${response.status})`);
			return null;
		}

		const serverUrlObj = new URL(serverUrl);
		const baseUrl = `${serverUrlObj.protocol}//${serverUrlObj.host}`;

		const wwwAuthenticate = response.headers.get("WWW-Authenticate");
		let authMetadata: OAuth2Metadata | null = null;
		let resourceMetadata: ProtectedResourceMetadata | null = null;
		let wwwAuthenticateScope: string | undefined;

		if (wwwAuthenticate) {
			log.debug(`WWW-Authenticate: ${wwwAuthenticate}`);

			const scopeMatch = wwwAuthenticate.match(/\bscope="([^"]+)"/);
			if (scopeMatch) {
				wwwAuthenticateScope = scopeMatch[1];
				log.debug(`Resource scope hint: ${wwwAuthenticateScope}`);
			}

			let resourceMetadataUrl: string | null = null;
			const resourceMetadataMatch = wwwAuthenticate.match(
				/resource_metadata="([^"]+)"/,
			);

			if (resourceMetadataMatch) {
				resourceMetadataUrl = resourceMetadataMatch[1];
				log.debug(`Resource metadata URL: ${resourceMetadataUrl}`);
			} else {
				log.debug(
					"No resource_metadata in WWW-Authenticate, trying standard location",
				);
				resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
				log.debug(`Trying: ${resourceMetadataUrl}`);
			}

			resourceMetadata = await fetchProtectedResourceMetadata(
				resourceMetadataUrl,
				tlsSkipVerify,
			);

			log.debug(`Trying direct OAuth discovery at: ${baseUrl}`);
			authMetadata = await fetchAuthServerMetadata(baseUrl, tlsSkipVerify, log);

			if (!authMetadata) {
				log.debug("Direct discovery failed, trying RFC 9728...");
				if (
					resourceMetadata &&
					resourceMetadata.authorization_servers &&
					resourceMetadata.authorization_servers.length > 0
				) {
					const authServerUrl = resourceMetadata.authorization_servers[0];
					log.debug(`Authorization server: ${authServerUrl}`);
					authMetadata = await fetchAuthServerMetadata(
						authServerUrl,
						tlsSkipVerify,
						log,
					);
				}
			}
		} else {
			log.debug(
				"401 but no WWW-Authenticate header; trying /.well-known/oauth-authorization-server",
			);
			authMetadata = await fetchAuthServerMetadata(baseUrl, tlsSkipVerify, log);
		}

		if (!authMetadata) {
			log.warn("Failed to fetch auth server metadata");
			return null;
		}

		const grantTypes = authMetadata.grant_types_supported;
		if (
			Array.isArray(grantTypes) &&
			!grantTypes.includes("authorization_code")
		) {
			log.debug("Auth server does not support authorization_code grant");
			return null;
		}
		const responseTypes = authMetadata.response_types_supported;
		if (Array.isArray(responseTypes) && !responseTypes.includes("code")) {
			log.debug("Auth server does not support response_type=code");
			return null;
		}

		const scope = resolveOAuthScope({
			resourceMetadata,
			wwwAuthenticateScope,
			authServerScopes: authMetadata.scopes_supported,
		});

		const config: OAuth2Config = {
			authorizationEndpoint: authMetadata.authorization_endpoint,
			tokenEndpoint: authMetadata.token_endpoint,
			resourceServer: serverUrl,
			registrationEndpoint: authMetadata.registration_endpoint,
			...(scope ? { scope } : {}),
		};

		log.success("OAuth2 detected");
		return config;
	} catch (error: any) {
		log.failure(`Error detecting OAuth2: ${error.message}`);
		return null;
	}
}
