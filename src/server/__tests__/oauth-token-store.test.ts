import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import { resetSecretCryptoForTests } from "../../shared/secret-crypto";
import { refreshAccessToken } from "../oauth-token-store";
import type { OAuth2Config } from "../../types/oauth";

describe("refreshAccessToken", () => {
	let home: string;
	let db: CapaDatabase;
	const oauth2Config: OAuth2Config = {
		authorizationEndpoint: "https://example.test/oauth/authorize",
		tokenEndpoint: "https://example.test/oauth/token",
		resourceServer: "https://example.test",
	};
	const originalFetch = globalThis.fetch;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;

	beforeEach(() => {
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		home = mkdtempSync(join(tmpdir(), "capa-oauth-refresh-"));
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		resetSecretCryptoForTests();
		db = new CapaDatabase(join(home, "test.db"));
		db.upsertProject({ id: "p1", path: "/p1" });
		db.setOAuthToken("p1", "slack", {
			access_token: "old-access",
			refresh_token: "old-refresh",
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		db.close();
		resetSecretCryptoForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		try {
			rmSync(home, { recursive: true, force: true });
		} catch {
			// Windows can keep capa.db locked briefly after close
		}
	});

	it("deletes stored tokens when refresh returns 401", async () => {
		globalThis.fetch = ((async () =>
			new Response("", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch);

		const ok = await refreshAccessToken(db, "p1", "slack", oauth2Config);
		expect(ok).toBe(false);
		expect(db.getOAuthToken("p1", "slack")).toBeNull();
	});

	it("does not call encryptSecret when refresh response omits access_token", async () => {
		globalThis.fetch = ((async () =>
			new Response(JSON.stringify({ token_type: "Bearer" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch);

		const ok = await refreshAccessToken(db, "p1", "slack", oauth2Config);
		expect(ok).toBe(false);
		expect(db.getOAuthToken("p1", "slack")).toBeNull();
	});
});
