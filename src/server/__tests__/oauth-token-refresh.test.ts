import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CapaDatabase } from "../../db/database";
import { resetSecretCryptoForTests } from "../../shared/secret-crypto";
import {
	parseOAuthTokenExchangeResponse,
	refreshAccessToken,
} from "../oauth-token-store";

describe("parseOAuthTokenExchangeResponse", () => {
	it("accepts standard OAuth token responses", () => {
		expect(
			parseOAuthTokenExchangeResponse({
				access_token: "new-access",
				refresh_token: "new-refresh",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "openid profile",
			}),
		).toEqual({
			accessToken: "new-access",
			refreshToken: "new-refresh",
			tokenType: "Bearer",
			expiresIn: 3600,
			scope: "openid profile",
		});
	});

	it("treats ok:false payloads without access_token as errors", () => {
		expect(
			parseOAuthTokenExchangeResponse({
				ok: false,
				error: "invalid_refresh_token",
			}),
		).toEqual({ error: "invalid_refresh_token" });
	});
});

describe("refreshAccessToken", () => {
	let db: CapaDatabase;
	let tempDir: string;
	let prevHome: string | undefined;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "capa-mcp-refresh-test-"));
		prevHome = process.env.HOME;
		process.env.HOME = tempDir;
		resetSecretCryptoForTests();
		db = new CapaDatabase(join(tempDir, "test.db"));
		db.setOAuthToken("p1", "mcp-server", {
			access_token: "old-access",
			refresh_token: "old-refresh",
			token_type: "Bearer",
			expires_at: Date.now() - 60_000,
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		db.close();
		resetSecretCryptoForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("keeps the token when the provider returns 200 without access_token", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: false, error: "invalid_refresh_token" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch;

		const ok = await refreshAccessToken(db, "p1", "mcp-server", {
			authorizationEndpoint: "https://example.com/authorize",
			tokenEndpoint: "https://example.com/token",
			resourceServer: "https://example.com",
			clientId: "test-app-id",
		});

		expect(ok).toBe(false);
		expect(db.getOAuthToken("p1", "mcp-server")?.refresh_token).toBe(
			"old-refresh",
		);
	});

	it("deletes the token only on a clear HTTP 403 from the token endpoint", async () => {
		globalThis.fetch = (async () =>
			new Response("forbidden", {
				status: 403,
				headers: { "Content-Type": "text/plain" },
			})) as unknown as typeof fetch;

		const ok = await refreshAccessToken(db, "p1", "mcp-server", {
			authorizationEndpoint: "https://example.com/authorize",
			tokenEndpoint: "https://example.com/token",
			resourceServer: "https://example.com",
			clientId: "test-app-id",
		});

		expect(ok).toBe(false);
		expect(db.getOAuthToken("p1", "mcp-server")).toBeNull();
	});

	it("uses embedded clientId from oauth2 config when no stored variable exists", async () => {
		let body = "";
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			body = String(init?.body ?? "");
			return new Response(
				JSON.stringify({
					access_token: "new-access",
					refresh_token: "new-refresh",
					expires_in: 3600,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const ok = await refreshAccessToken(db, "p1", "mcp-server", {
			authorizationEndpoint: "https://example.com/authorize",
			tokenEndpoint: "https://example.com/token",
			resourceServer: "https://example.com",
			clientId: "test-app-id",
		});

		expect(ok).toBe(true);
		expect(new URLSearchParams(body).get("client_id")).toBe("test-app-id");
	});

	it("refreshes when oauth2 config only has legacy tokenUrl alias", async () => {
		let postedUrl = "";
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			postedUrl = String(input);
			return new Response(
				JSON.stringify({
					access_token: "new-access",
					refresh_token: "new-refresh",
					expires_in: 3600,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const ok = await refreshAccessToken(db, "p1", "mcp-server", {
			authorizationUrl: "https://example.com/authorize",
			tokenUrl: "https://example.com/token",
			resourceServer: "https://example.com",
			clientId: "test-app-id",
		});

		expect(ok).toBe(true);
		expect(postedUrl).toBe("https://example.com/token");
	});
});
