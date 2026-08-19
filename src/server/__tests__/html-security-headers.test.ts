import { describe, expect, it } from "bun:test";
import { htmlSecurityHeaders } from "../html-security-headers";
import { oauthBridgeResponse } from "../oauth-bridge";

describe("htmlSecurityHeaders", () => {
	it("sets CSP and nosniff", () => {
		const headers = htmlSecurityHeaders({ "Content-Type": "text/html" });
		expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
		expect(headers["Content-Security-Policy"]).toContain(
			"https://fonts.googleapis.com",
		);
		expect(headers["Content-Security-Policy"]).toContain(
			"https://fonts.gstatic.com",
		);
		expect(headers["Content-Security-Policy"]).toContain("img-src 'self' data: https:");
		expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
		expect(headers["X-Content-Type-Options"]).toBe("nosniff");
		expect(headers["Content-Type"]).toBe("text/html");
	});
});

describe("oauthBridgeResponse", () => {
	it("includes CSP on OAuth-bridge HTML", () => {
		const res = oauthBridgeResponse("github");
		expect(res.headers.get("Content-Security-Policy")).toContain(
			"default-src 'self'",
		);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
});
