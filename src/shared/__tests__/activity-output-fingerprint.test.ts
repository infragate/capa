import { describe, expect, it } from "bun:test";
import {
	fingerprintActivityOutput,
	normalizeActivityOutputText,
	providerShellLooksLikeCapaSh,
} from "../activity-output-fingerprint";

describe("activity-output-fingerprint", () => {
	it("normalizes CRLF before hashing", () => {
		const a = fingerprintActivityOutput("line1\r\nline2");
		const b = fingerprintActivityOutput("line1\nline2");
		expect(a).toBe(b);
	});

	it("hashes empty output deterministically", () => {
		expect(fingerprintActivityOutput("")).toBe(fingerprintActivityOutput(null));
	});

	it("detects capa sh in provider shell tool_name", () => {
		expect(
			providerShellLooksLikeCapaSh({
				tool_name: "capa sh glean search --query foo",
				args_json: null,
			}),
		).toBe(true);
		expect(
			providerShellLooksLikeCapaSh({
				tool_name: "ls -la",
				args_json: JSON.stringify({ command: "capa sh db query" }),
			}),
		).toBe(true);
	});

	it("normalizeActivityOutputText strips lone CR", () => {
		expect(normalizeActivityOutputText("a\rb")).toBe("a\nb");
	});

	it("matches fingerprints when outputs differ only after the preview prefix", () => {
		const shared = "x".repeat(6_000);
		const a = fingerprintActivityOutput(`${shared}tail-a`);
		const b = fingerprintActivityOutput(`${shared}tail-b`);
		expect(a).toBe(b);
	});
});
