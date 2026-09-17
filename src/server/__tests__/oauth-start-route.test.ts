import { afterEach, describe, expect, it } from "bun:test";
import type { CapaDatabase } from "../../db/database";
import type { Capabilities } from "../../types/capabilities";
import type { OAuth2Config } from "../../types/oauth";
import { OAuth2DetectionStatus, type OAuth2Manager } from "../oauth-manager";
import { generateAuthorizationUrl } from "../oauth-pkce-flow";
import { handleOAuth2Start, type OAuthRouteDeps } from "../oauth-routes";
import type { SessionManager } from "../session-manager";

const originalFetch = globalThis.fetch;

/** Persisted by an older release: the gateway's own AS, and the gateway as audience. */
const PERSISTED_GATEWAY_OAUTH = {
	authorizationEndpoint: "https://mcp-gateway.example.test/v1/authorize",
	tokenEndpoint: "https://mcp-gateway.example.test/v1/token",
	registrationEndpoint: "https://mcp-gateway.example.test/v1/register",
	resourceServer: "https://mcp-gateway.example.test/mcp",
	clientId: "gateway-issued-client",
	scope: "read:me",
};

/** What discovery now returns: the Identity AS listed in the resource's PRM. */
const DISCOVERED_IDENTITY_OAUTH: OAuth2Config = {
	authorizationEndpoint: "https://identity.example.test/authorize",
	tokenEndpoint: "https://identity.example.test/token",
	registrationEndpoint: "https://identity.example.test/register",
	resourceServer: "https://mcp-gateway.example.test/v2/mcp",
	scope: "read:me offline_access",
};

function makeMockDb(): CapaDatabase {
	return {
		storeFlowState: () => {},
		deleteExpiredFlowStates: () => {},
		getVariable: () => null,
		setVariable: () => {},
		deleteVariable: () => {},
	} as unknown as CapaDatabase;
}

function makeCapabilities(): Capabilities {
	return {
		providers: [],
		skills: [],
		tools: [],
		servers: [
			{
				id: "gateway",
				type: "mcp",
				def: {
					url: "https://mcp-gateway.example.test/v2/mcp",
					oauth2: PERSISTED_GATEWAY_OAUTH,
				},
			},
		],
	};
}

function makeDeps(
	db: CapaDatabase,
	capabilities: Capabilities,
): OAuthRouteDeps {
	return {
		db,
		sessionManager: {
			getProjectCapabilities: () => capabilities,
			setProjectCapabilities: () => {},
		} as unknown as SessionManager,
		oauth2Manager: {
			detectOAuth2Requirement: async () => ({
				status: OAuth2DetectionStatus.REQUIRED,
				config: DISCOVERED_IDENTITY_OAUTH,
			}),
			generateAuthorizationUrl: (
				projectId: string,
				serverId: string,
				config: OAuth2Config,
				redirectUri: string,
			) =>
				generateAuthorizationUrl(
					db,
					projectId,
					serverId,
					config,
					redirectUri,
				),
		} as unknown as OAuth2Manager,
		serverHost: "127.0.0.1",
		serverPort: 4711,
		uiOrigin: () => "http://127.0.0.1:4711",
		effectiveCapsCache: new Map(),
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("handleOAuth2Start", () => {
	it("reconnects against the freshly discovered auth server, not persisted gateway endpoints", async () => {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			if (String(input) === "https://identity.example.test/register") {
				return Response.json({ client_id: "identity-issued-client" });
			}
			return new Response("", { status: 404 });
		}) as unknown as typeof fetch;

		const capabilities = makeCapabilities();
		const deps = makeDeps(makeMockDb(), capabilities);

		const response = await handleOAuth2Start(
			deps,
			"project-1",
			new Request(
				"http://127.0.0.1:4711/api/projects/project-1/oauth/start?server=gateway",
			),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { authorizationUrl: string };
		const authUrl = new URL(body.authorizationUrl);

		expect(authUrl.origin + authUrl.pathname).toBe(
			"https://identity.example.test/authorize",
		);
		expect(authUrl.searchParams.get("resource")).toBe(
			"https://mcp-gateway.example.test/v2/mcp",
		);
		// The configured client id is the plugin's application identity, not one
		// dynamic registration issued, so moving auth server does not discard it.
		expect(authUrl.searchParams.get("client_id")).toBe("gateway-issued-client");

		const saved = capabilities.servers[0]?.def.oauth2;
		expect(saved?.authorizationEndpoint).toBe(
			"https://identity.example.test/authorize",
		);
		expect(saved?.tokenEndpoint).toBe("https://identity.example.test/token");
		expect(saved?.resourceServer).toBe(
			"https://mcp-gateway.example.test/v2/mcp",
		);
	});
});
