import { describe, expect, it } from "bun:test";
import { extractActivityCorrelation } from "../activity-correlation";

describe("extractActivityCorrelation", () => {
	it("reads Cursor conversation_id + generation_id from provider config", () => {
		const out = extractActivityCorrelation("cursor", {
			conversation_id: "conv-1",
			generation_id: "gen-9",
			tool_name: "Read",
		});
		expect(out).toEqual({
			conversationId: "conv-1",
			generationId: "gen-9",
		});
	});

	it("reads Claude session_id + prompt_id from provider config", () => {
		const out = extractActivityCorrelation("claude-code", {
			session_id: "sess-1",
			prompt_id: "prompt-2",
		});
		expect(out).toEqual({
			conversationId: "sess-1",
			generationId: "prompt-2",
		});
	});

	it("returns nulls when provider has no activityCorrelation config", () => {
		const out = extractActivityCorrelation("gemini-cli", {
			session_id: "sess-1",
			conversation_id: "conv-1",
		});
		expect(out).toEqual({ conversationId: null, generationId: null });
	});

	it("returns nulls for unknown provider / empty payload", () => {
		expect(extractActivityCorrelation(null, { conversation_id: "x" })).toEqual({
			conversationId: null,
			generationId: null,
		});
		expect(extractActivityCorrelation("cursor", null)).toEqual({
			conversationId: null,
			generationId: null,
		});
	});
});
