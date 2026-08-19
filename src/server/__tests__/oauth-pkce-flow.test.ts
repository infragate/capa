import { describe, expect, it } from "bun:test";
import { clientUriForRegistration } from "../oauth-pkce-flow";

describe("clientUriForRegistration", () => {
	it("uses localhost with the redirect URI port", () => {
		expect(
			clientUriForRegistration(
				"http://127.0.0.1:5912/api/projects/demo/oauth/callback",
			),
		).toBe("http://localhost:5912");
	});

	it("omits the port when the redirect URI uses the default HTTP port", () => {
		expect(
			clientUriForRegistration("http://127.0.0.1/api/projects/demo/oauth/callback"),
		).toBe("http://localhost");
	});
});
