import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import type { OAuth2Config } from "../types/oauth";
import {
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
} from "../utils/pkce";
import {
	resolveAuthorizationEndpoint,
	resolveTokenEndpoint,
} from "./oauth-endpoint-resolve";

const pkceLogger = logger.child("OAuth2PKCE");

/**
 * Register a dynamic OAuth client (RFC 7591)
 */
export async function registerClient(
	registrationEndpoint: string,
	redirectUri: string,
): Promise<any> {
	const response = await fetch(registrationEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_name: "CAPA - Capabilities Package Manager",
			client_uri: "https://github.com/infragate/capa",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			application_type: "native",
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Registration failed: ${response.status} ${errorText}`);
	}

	return await response.json();
}

/**
 * Generate authorization URL for OAuth2 flow with PKCE
 */
export async function generateAuthorizationUrl(
	db: CapaDatabase,
	projectId: string,
	serverId: string,
	oauth2Config: OAuth2Config,
	redirectUri: string,
	log = pkceLogger,
): Promise<{ url: string; state: string }> {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);
	const state = generateState();

	let clientId = oauth2Config.client_id ?? "capa";
	if (!oauth2Config.client_id && oauth2Config.registrationEndpoint) {
		try {
			log.info("Attempting dynamic client registration...");
			const registeredClient = await registerClient(
				oauth2Config.registrationEndpoint,
				redirectUri,
			);
			if (registeredClient && registeredClient.client_id) {
				clientId = registeredClient.client_id;
				log.success(`Registered client: ${clientId}`);

				if (registeredClient.client_secret) {
					db.setVariable(
						projectId,
						`oauth2_client_secret_${serverId}`,
						registeredClient.client_secret,
					);
				}
			}
		} catch (error: any) {
			log.warn(`Dynamic registration failed: ${error.message}`);
			log.info("Using default client_id");
		}
	} else if (oauth2Config.client_id) {
		log.debug(`Using embedded client_id from server config`);
	}

	db.storeFlowState(
		state,
		projectId,
		serverId,
		codeVerifier,
		redirectUri,
		clientId,
	);

	db.deleteExpiredFlowStates(10);

	const authorizationEndpoint = resolveAuthorizationEndpoint(oauth2Config);
	if (!authorizationEndpoint) {
		throw new Error(
			"OAuth authorization endpoint is missing. Re-configure the project or reconnect after OAuth discovery succeeds.",
		);
	}
	const authUrl = new URL(authorizationEndpoint);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	if (oauth2Config.scope) {
		authUrl.searchParams.set("scope", oauth2Config.scope);
	}

	log.info(`Generated authorization URL for ${serverId}`);
	return { url: authUrl.toString(), state };
}

/**
 * Handle OAuth2 callback - exchange authorization code for tokens
 */
export async function handleCallback(
	db: CapaDatabase,
	code: string,
	state: string,
	capabilitiesProvider: (() => Map<string, any>) | undefined,
	log = pkceLogger,
): Promise<{
	success: boolean;
	projectId?: string;
	serverId?: string;
	error?: string;
}> {
	try {
		const flowState = db.getFlowState(state);
		if (!flowState) {
			return { success: false, error: "Invalid or expired state parameter" };
		}

		let code_verifier: string;
		let redirect_uri: string;
		let client_id: string = "capa";

		try {
			const stateData = JSON.parse(flowState.code_verifier);
			code_verifier = stateData.code_verifier;
			redirect_uri = stateData.redirect_uri || flowState.redirect_uri;
			client_id = stateData.client_id || "capa";
		} catch {
			code_verifier = flowState.code_verifier;
			redirect_uri = flowState.redirect_uri;
		}

		const { project_id, server_id } = flowState;

		db.deleteFlowState(state);

		if (!capabilitiesProvider) {
			return { success: false, error: "Project capabilities not found" };
		}
		const capabilities = capabilitiesProvider()?.get(project_id) || null;
		if (!capabilities) {
			return { success: false, error: "Project capabilities not found" };
		}

		const server = capabilities.servers.find((s: any) => s.id === server_id);
		if (!server || !server.def.oauth2) {
			return { success: false, error: "Server OAuth2 config not found" };
		}

		const oauth2Config = server.def.oauth2 as OAuth2Config;
		const tokenEndpoint = resolveTokenEndpoint(oauth2Config);
		if (!tokenEndpoint) {
			return {
				success: false,
				error: "OAuth token endpoint is missing for this server",
			};
		}

		const clientSecret = db.getVariable(
			project_id,
			`oauth2_client_secret_${server_id}`,
		);

		log.info("Exchanging code for tokens");
		log.debug(`client_id: ${client_id}`);
		log.debug(`token_endpoint: ${tokenEndpoint}`);

		db.setVariable(project_id, `oauth2_client_id_${server_id}`, client_id);

		const tokenParams: Record<string, string> = {
			grant_type: "authorization_code",
			code: code,
			redirect_uri: redirect_uri,
			client_id: client_id,
			code_verifier: code_verifier,
		};

		if (clientSecret) {
			tokenParams.client_secret = clientSecret;
		}

		const tokenResponse = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams(tokenParams).toString(),
		});

		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text();
			log.failure(`Token exchange failed: ${errorText}`);
			return {
				success: false,
				error: "Failed to exchange authorization code for tokens",
			};
		}

		const tokenData = await tokenResponse.json();

		const expiresAt = tokenData.expires_in
			? Date.now() + tokenData.expires_in * 1000
			: undefined;

		db.setOAuthToken(project_id, server_id, {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token,
			token_type: tokenData.token_type || "Bearer",
			expires_at: expiresAt,
			scope: tokenData.scope,
		});

		log.success(`Tokens stored for ${server_id}`);
		return { success: true, projectId: project_id, serverId: server_id };
	} catch (error: any) {
		log.failure(`Callback error: ${error.message}`);
		return {
			success: false,
			error: error.message || "Token exchange failed",
		};
	}
}
