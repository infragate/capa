import type { GitIntegrationManager } from "./git-integration-manager";
import { gitOAuthCallbackNeedsBridge, oauthBridgeResponse } from "./oauth-bridge";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface GitIntegrationsRouteDeps {
	gitIntegrationManager: GitIntegrationManager;
	uiOrigin: () => string;
	serverHost: string;
	serverPort: number;
}

export async function handleGetIntegrations(
	deps: GitIntegrationsRouteDeps,
): Promise<Response> {
	try {
		const integrations = await deps.gitIntegrationManager.getAllIntegrations();
		return new Response(JSON.stringify({ integrations }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

function readOAuthNonce(source: Record<string, unknown>): string | null {
	if (typeof source.state === "string" && source.state.length > 0) {
		return source.state;
	}
	if (typeof source.flowId === "string" && source.flowId.length > 0) {
		return source.flowId;
	}
	return null;
}

function missingStateResponse(): Response {
	return new Response(
		JSON.stringify({ error: "Missing OAuth state or flowId" }),
		{ status: 400, headers: JSON_HEADERS },
	);
}

async function completeGitOAuthCallback(
	deps: GitIntegrationsRouteDeps,
	platform: "github" | "gitlab",
	accessToken: string,
	state: string,
	refreshToken?: string,
	expiresIn?: number,
): Promise<Response> {
	const result = await deps.gitIntegrationManager.handleCallback(
		accessToken,
		state,
		refreshToken,
		expiresIn,
	);

	if (!result.success) {
		return new Response(
			JSON.stringify({ error: result.error || "Invalid or expired OAuth state" }),
			{ status: 400, headers: JSON_HEADERS },
		);
	}

	const redirectUrl = `${deps.uiOrigin()}/ui/integrations?success=${platform}`;
	return new Response(null, {
		status: 302,
		headers: { Location: redirectUrl },
	});
}

export async function handleGitHubOAuthStart(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		const localCallbackUri = `http://${deps.serverHost}:${deps.serverPort}/api/integrations/github/oauth/callback`;

		const { url: authUrl, flowId, state } =
			await deps.gitIntegrationManager.generateAuthorizationUrl(
				"github",
				localCallbackUri,
			);

		return new Response(
			JSON.stringify({ authorizationUrl: authUrl, flowId, state }),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGitHubOAuthCallback(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		let accessToken: string | null = null;
		let refreshToken: string | undefined;
		let expiresIn: number | undefined;
		let error: string | null = null;

		let state: string | null = null;

		if (request.method === "POST") {
			const body = (await request.json()) as Record<string, unknown>;
			accessToken =
				typeof body.access_token === "string" ? body.access_token : null;
			refreshToken =
				typeof body.refresh_token === "string" ? body.refresh_token : undefined;
			if (body.expires_in != null) {
				expiresIn = parseInt(String(body.expires_in), 10);
			}
			error = typeof body.error === "string" ? body.error : null;
			state = readOAuthNonce(body);
		} else {
			const url = new URL(request.url);
			if (gitOAuthCallbackNeedsBridge(url)) {
				return oauthBridgeResponse("github");
			}
			error = url.searchParams.get("error");
		}

		if (error) {
			const redirectUrl = `${deps.uiOrigin()}/ui/integrations?error=${encodeURIComponent(error)}`;
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		}

		if (!accessToken) {
			return new Response(
				JSON.stringify({ error: "Missing access_token parameter" }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		if (!state) {
			return missingStateResponse();
		}

		return completeGitOAuthCallback(
			deps,
			"github",
			accessToken,
			state,
			refreshToken,
			expiresIn,
		);
	} catch (error: any) {
		const redirectUrl = `${deps.uiOrigin()}/ui/integrations?error=${encodeURIComponent(error.message)}`;
		return new Response(null, {
			status: 302,
			headers: { Location: redirectUrl },
		});
	}
}

export async function handleGitLabOAuthStart(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		const localCallbackUri = `http://${deps.serverHost}:${deps.serverPort}/api/integrations/gitlab/oauth/callback`;

		const { url: authUrl, flowId, state } =
			await deps.gitIntegrationManager.generateAuthorizationUrl(
				"gitlab",
				localCallbackUri,
			);

		return new Response(
			JSON.stringify({ authorizationUrl: authUrl, flowId, state }),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGitLabOAuthCallback(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		let accessToken: string | null = null;
		let refreshToken: string | undefined;
		let expiresIn: number | undefined;
		let error: string | null = null;
		let state: string | null = null;

		if (request.method === "POST") {
			const body = (await request.json()) as Record<string, unknown>;
			accessToken =
				typeof body.access_token === "string" ? body.access_token : null;
			refreshToken =
				typeof body.refresh_token === "string" ? body.refresh_token : undefined;
			if (body.expires_in != null) {
				expiresIn = parseInt(String(body.expires_in), 10);
			}
			error = typeof body.error === "string" ? body.error : null;
			state = readOAuthNonce(body);
		} else {
			const url = new URL(request.url);
			if (gitOAuthCallbackNeedsBridge(url)) {
				return oauthBridgeResponse("gitlab");
			}
			error = url.searchParams.get("error");
		}

		if (error) {
			const redirectUrl = `${deps.uiOrigin()}/ui/integrations?error=${encodeURIComponent(error)}`;
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		}

		if (!accessToken) {
			return new Response(
				JSON.stringify({ error: "Missing access_token parameter" }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		if (!state) {
			return missingStateResponse();
		}

		return completeGitOAuthCallback(
			deps,
			"gitlab",
			accessToken,
			state,
			refreshToken,
			expiresIn,
		);
	} catch (error: any) {
		const redirectUrl = `${deps.uiOrigin()}/ui/integrations?error=${encodeURIComponent(error.message)}`;
		return new Response(null, {
			status: 302,
			headers: { Location: redirectUrl },
		});
	}
}

export async function handleGitTokenRefresh(
	deps: GitIntegrationsRouteDeps,
	platform: "github" | "gitlab",
): Promise<Response> {
	try {
		const success =
			await deps.gitIntegrationManager.refreshAccessToken(platform);

		if (!success) {
			return new Response(
				JSON.stringify({
					success: false,
					error: "Token refresh failed. Re-authentication may be required.",
				}),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(
			JSON.stringify({ success: false, error: error.message }),
			{ status: 500, headers: JSON_HEADERS },
		);
	}
}

export async function handleGitHubEnterprisePAT(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		const body = await request.json();
		const { host, token } = body;

		if (!host || !token) {
			return new Response(JSON.stringify({ error: "Missing host or token" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}

		await deps.gitIntegrationManager.storePAT({
			platform: "github-enterprise",
			host,
			token,
		});

		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGitLabSelfManagedPAT(
	deps: GitIntegrationsRouteDeps,
	request: Request,
): Promise<Response> {
	try {
		const body = await request.json();
		const { host, token } = body;

		if (!host || !token) {
			return new Response(JSON.stringify({ error: "Missing host or token" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}

		await deps.gitIntegrationManager.storePAT({
			platform: "gitlab-self-managed",
			host,
			token,
		});

		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleDisconnectIntegration(
	deps: GitIntegrationsRouteDeps,
	platform: string,
	host?: string,
): Promise<Response> {
	try {
		deps.gitIntegrationManager.disconnect(platform as any, host);
		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}
