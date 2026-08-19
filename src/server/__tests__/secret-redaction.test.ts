import { describe, expect, it } from "bun:test";
import { mergeServerDef, redactServerForApi } from "../secret-redaction";

const ENV_SECRET = "mcp-env-secret-ABCDEFGH";
const HEADER_SECRET = "Bearer mcp-header-secret-1234";
const OAUTH_SECRET = "oauth-client-secret-WXYZ";

describe("redactServerForApi", () => {
	it("omits oauth clientSecret and does not leak env or auth header values", () => {
		const redacted = redactServerForApi({
			id: "svc",
			env: { OPENAI_API_KEY: ENV_SECRET, NODE_ENV: "production" },
			headers: {
				Authorization: HEADER_SECRET,
				"X-Api-Key": "api-key-value-9999",
				Accept: "application/json",
			},
			oauth2: {
				clientId: "public-client",
				clientSecret: OAUTH_SECRET,
			},
		});

		const json = JSON.stringify(redacted);
		expect(json).not.toContain(ENV_SECRET);
		expect(json).not.toContain(HEADER_SECRET);
		expect(json).not.toContain(OAUTH_SECRET);
		expect(json).not.toContain("api-key-value-9999");
		expect(redacted.oauth2?.clientSecret).toBeUndefined();
		expect(redacted.oauth2?.clientId).toBe("public-client");
	});

	it("keeps fromEnv/fromCommand/fromFile refs visible (they are not secrets)", () => {
		const redacted = redactServerForApi({
			env: { TOKEN: { fromEnv: "OP_TOKEN" } },
			headers: { Authorization: { fromCommand: "op read op://x" } },
		});
		expect(redacted.env?.TOKEN).toEqual({ fromEnv: "OP_TOKEN" });
		expect(redacted.headers?.Authorization).toEqual({
			fromCommand: "op read op://x",
		});
	});
});

describe("mergeServerDef", () => {
	it("keeps existing env values, headers, and clientSecret when the patch omits or blanks them", () => {
		const merged = mergeServerDef(
			{
				cmd: "npx",
				env: { API_KEY: "keep-me", NODE_ENV: "production" },
				headers: { Authorization: "Bearer keep-token", Accept: "application/json" },
				oauth2: { clientId: "id", clientSecret: "keep-secret" },
			},
			{
				cmd: "npx",
				env: { API_KEY: "", NODE_ENV: "production", NEW: "added" },
				headers: { Accept: "application/json" },
				oauth2: { clientId: "id" },
			},
		);
		expect(merged.env).toEqual({
			API_KEY: "keep-me",
			NODE_ENV: "production",
			NEW: "added",
		});
		expect(merged.headers).toEqual({
			Authorization: "Bearer keep-token",
			Accept: "application/json",
		});
		expect((merged.oauth2 as Record<string, unknown>).clientSecret).toBe(
			"keep-secret",
		);
	});
});
