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
 * Fetch authorization server metadata (RFC 8414)
 * Path: /.well-known/oauth-authorization-server
 */
export async function fetchAuthServerMetadata(
	authServerUrl: string,
	tlsSkipVerify?: boolean,
	log = logger.child("OAuth2Discovery"),
): Promise<OAuth2Metadata | null> {
	try {
		const wellKnownUrl = new URL(
			"/.well-known/oauth-authorization-server",
			authServerUrl,
		).toString();

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

		if (wwwAuthenticate) {
			log.debug(`WWW-Authenticate: ${wwwAuthenticate}`);

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

			log.debug(`Trying direct OAuth discovery at: ${baseUrl}`);
			authMetadata = await fetchAuthServerMetadata(baseUrl, tlsSkipVerify, log);

			if (!authMetadata) {
				log.debug("Direct discovery failed, trying RFC 9728...");
				const resourceMetadata = await fetchProtectedResourceMetadata(
					resourceMetadataUrl,
					tlsSkipVerify,
				);

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

		const config: OAuth2Config = {
			authorizationEndpoint: authMetadata.authorization_endpoint,
			tokenEndpoint: authMetadata.token_endpoint,
			resourceServer: serverUrl,
			registrationEndpoint: authMetadata.registration_endpoint,
			scope: authMetadata.scopes_supported?.join(" "),
		};

		log.success("OAuth2 detected");
		return config;
	} catch (error: any) {
		log.failure(`Error detecting OAuth2: ${error.message}`);
		return null;
	}
}
