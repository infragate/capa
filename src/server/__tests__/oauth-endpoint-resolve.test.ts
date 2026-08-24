import { describe, expect, it } from "bun:test";
import {
	resolveAuthorizationEndpoint,
	resolveTokenEndpoint,
} from "../oauth-endpoint-resolve";

describe("resolveTokenEndpoint", () => {
	it("prefers canonical tokenEndpoint", () => {
		expect(
			resolveTokenEndpoint({
				tokenEndpoint: "https://auth.example/token",
				tokenUrl: "https://legacy.example/token",
			} as never),
		).toBe("https://auth.example/token");
	});

	it("falls back to tokenUrl / snake_case aliases", () => {
		expect(
			resolveTokenEndpoint({
				tokenUrl: "https://auth.example/token",
			} as never),
		).toBe("https://auth.example/token");
		expect(
			resolveTokenEndpoint({
				token_url: "https://auth.example/token",
			} as never),
		).toBe("https://auth.example/token");
		expect(
			resolveTokenEndpoint({
				token_endpoint: "https://auth.example/token",
			} as never),
		).toBe("https://auth.example/token");
	});

	it("returns undefined when no endpoint is present", () => {
		expect(resolveTokenEndpoint({} as never)).toBeUndefined();
	});
});

describe("resolveAuthorizationEndpoint", () => {
	it("falls back to authorizationUrl aliases", () => {
		expect(
			resolveAuthorizationEndpoint({
				authorizationUrl: "https://auth.example/authorize",
			} as never),
		).toBe("https://auth.example/authorize");
		expect(
			resolveAuthorizationEndpoint({
				authorization_url: "https://auth.example/authorize",
			} as never),
		).toBe("https://auth.example/authorize");
	});
});
