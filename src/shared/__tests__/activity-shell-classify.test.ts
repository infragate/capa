import { describe, expect, it } from "bun:test";
import { providerShellLooksLikeCapaSh } from "../activity-shell-classify";

describe("activity-shell-classify", () => {
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
		expect(
			providerShellLooksLikeCapaSh({
				tool_name: "ls -la",
				args_json: JSON.stringify({ command: "echo hi" }),
			}),
		).toBe(false);
	});
});
