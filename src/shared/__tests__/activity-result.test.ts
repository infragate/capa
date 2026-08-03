import { describe, expect, it } from "bun:test";
import { extractActivityResult } from "../activity-result";
import { normalizeActivityHookPayload } from "../agent-activity-normalize";

describe("extractActivityResult", () => {
	it("reads Claude tool_response from provider config", () => {
		const out = extractActivityResult("claude-code", {
			tool_name: "Bash",
			tool_input: { command: "ls" },
			tool_response: { stdout: "a.txt\n", stderr: "", interrupted: false },
		});
		expect(out).toEqual({
			stdout: "a.txt\n",
			stderr: "",
			interrupted: false,
		});
	});

	it("reads Cursor tool_output from provider config", () => {
		const out = extractActivityResult("cursor", {
			tool_name: "Shell",
			tool_output: "{\"exitCode\":0,\"stdout\":\"ok\"}",
		});
		expect(out).toBe("{\"exitCode\":0,\"stdout\":\"ok\"}");
	});

	it("returns undefined when provider has no result field map", () => {
		expect(
			extractActivityResult("gemini-cli", { tool_response: { ok: true } }),
		).toBeUndefined();
	});
});

describe("normalizeActivityHookPayload Claude results", () => {
	it("stores Claude PostToolUse tool_response as resultPreview", () => {
		const out = normalizeActivityHookPayload(
			"afterTool",
			{
				tool_name: "Write",
				tool_input: { file_path: "/tmp/a.txt", content: "hi" },
				tool_response: { filePath: "/tmp/a.txt", success: true },
				session_id: "sess-1",
				prompt_id: "p-1",
			},
			"claude-code",
		);
		expect(out.skip).toBe(false);
		expect(out.resultPreview).toEqual({
			filePath: "/tmp/a.txt",
			success: true,
		});
	});

	it("stores Claude Bash tool_response on afterShell", () => {
		const out = normalizeActivityHookPayload(
			"afterShell",
			{
				tool_name: "Bash",
				tool_input: { command: "echo hi" },
				tool_response: { stdout: "hi\n", stderr: "", interrupted: false },
			},
			"claude-code",
		);
		expect(out.skip).toBe(false);
		expect(out.resultPreview).toEqual({
			stdout: "hi\n",
			stderr: "",
			interrupted: false,
		});
	});
});
