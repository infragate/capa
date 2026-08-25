import { afterEach, describe, expect, it } from "bun:test";
import {
	buildOAuthAuthorizationServerMetadataUrl,
	detectOAuth2Requirement,
	OAuth2DetectionStatus,
	resolveOAuthScope,
	sanitizeOAuthScope,
} from "../oauth-discovery";

describe("buildOAuthAuthorizationServerMetadataUrl", () => {
	it("uses origin-root well-known for issuers without a path", () => {
		expect(
			buildOAuthAuthorizationServerMetadataUrl("https://auth.example.com"),
		).toBe("https://auth.example.com/.well-known/oauth-authorization-server");
	});

	it("inserts well-known between host and path for path-based issuers (RFC 8414)", () => {
		expect(
			buildOAuthAuthorizationServerMetadataUrl(
				"https://auth.example.com/realms/tenant",
			),
		).toBe(
			"https://auth.example.com/.well-known/oauth-authorization-server/realms/tenant",
		);
	});

	it("strips a trailing slash from the issuer path", () => {
		expect(
			buildOAuthAuthorizationServerMetadataUrl(
				"https://auth.example.com/tenant1/",
			),
		).toBe(
			"https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
		);
	});
});

describe("resolveOAuthScope", () => {
	it("prefers protected-resource scopes over the auth-server catalog", () => {
		expect(
			resolveOAuthScope({
				resourceMetadata: {
					resource: "https://gateway.example.test/mcp",
					authorization_servers: ["https://auth.example.test/realms/x"],
					scopes_supported: [
						"openid",
						"email",
						"profile",
						"offline_access",
						"api.read",
					],
				},
				authServerScopes: [
					"openid",
					"profile",
					"roles",
					"service_account",
					"web-origins",
				],
			}),
		).toBe("openid email profile offline_access api.read");
	});

	it("falls back to the WWW-Authenticate scope hint", () => {
		expect(
			resolveOAuthScope({
				wwwAuthenticateScope: "openid profile email",
				authServerScopes: ["openid", "service_account"],
			}),
		).toBe("openid profile email");
	});
});

describe("sanitizeOAuthScope", () => {
	it("removes scopes invalid for user-facing authorization_code clients", () => {
		expect(
			sanitizeOAuthScope(
				"openid profile email offline_access roles service_account web-origins",
			),
		).toBe("openid profile email offline_access");
	});
});

describe("detectOAuth2Requirement", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("detects OAuth2 for path-based authorization servers via RFC 9728 metadata", async () => {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (
				url === "https://mcp-gateway.example.test/mcp" &&
				init?.method === "POST"
			) {
				return new Response("", {
					status: 401,
					headers: {
						"WWW-Authenticate":
							'Bearer error="invalid_token", resource_metadata="https://mcp-gateway.example.test/.well-known/oauth-protected-resource/mcp"',
					},
				});
			}
			if (
				url ===
				"https://mcp-gateway.example.test/.well-known/oauth-protected-resource/mcp"
			) {
				return Response.json({
					resource: "https://mcp-gateway.example.test/mcp",
					authorization_servers: [
						"https://mcp-auth.example.test/realms/tenant",
					],
					scopes_supported: [
						"openid",
						"email",
						"profile",
						"offline_access",
						"api.read",
					],
				});
			}
			if (
				url ===
				"https://mcp-auth.example.test/.well-known/oauth-authorization-server/realms/tenant"
			) {
				return Response.json({
					authorization_endpoint:
						"https://mcp-auth.example.test/realms/tenant/protocol/openid-connect/auth",
					token_endpoint:
						"https://mcp-auth.example.test/realms/tenant/protocol/openid-connect/token",
					grant_types_supported: ["authorization_code"],
					response_types_supported: ["code"],
					scopes_supported: [
						"openid",
						"profile",
						"roles",
						"service_account",
						"web-origins",
					],
				});
			}
			return new Response("", { status: 404 });
		}) as unknown as typeof fetch;

		const result = await detectOAuth2Requirement(
			"https://mcp-gateway.example.test/mcp",
		);
		expect(result.status).toBe(OAuth2DetectionStatus.REQUIRED);
		if (result.status !== OAuth2DetectionStatus.REQUIRED) return;
		expect(result.config.authorizationEndpoint).toBe(
			"https://mcp-auth.example.test/realms/tenant/protocol/openid-connect/auth",
		);
		expect(result.config.tokenEndpoint).toBe(
			"https://mcp-auth.example.test/realms/tenant/protocol/openid-connect/token",
		);
		expect(result.config.scope).toBe(
			"openid email profile offline_access api.read",
		);
	});

	it("returns inconclusive when the MCP server is unreachable", async () => {
		globalThis.fetch = (async () => {
			throw new DOMException("The operation was aborted.", "AbortError");
		}) as unknown as typeof fetch;

		const result = await detectOAuth2Requirement(
			"https://unreachable.example.test/mcp",
		);
		expect(result.status).toBe(OAuth2DetectionStatus.INCONCLUSIVE);
	});

	it("returns not_required on a successful unauthenticated initialize", async () => {
		globalThis.fetch = (async () =>
			new Response("", { status: 200 })) as unknown as typeof fetch;

		const result = await detectOAuth2Requirement(
			"https://open.example.test/mcp",
		);
		expect(result.status).toBe(OAuth2DetectionStatus.NOT_REQUIRED);
	});
});
