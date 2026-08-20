import { describe, expect, it } from "bun:test";
import {
	chatConversationIdFromTranscriptPath,
	reconcileCursorActivityConversationIds,
} from "../activity-correlation-reconcile";

describe("chatConversationIdFromTranscriptPath", () => {
	it("parses Cursor agent transcript paths", () => {
		const path =
			"/Users/me/.cursor/projects/foo/agent-transcripts/5838f384-e543-41e8-be49-57fb1de0d433/5838f384.jsonl";
		expect(chatConversationIdFromTranscriptPath(path)).toBe(
			"5838f384-e543-41e8-be49-57fb1de0d433",
		);
	});
});

describe("reconcileCursorActivityConversationIds", () => {
	it("rewrites tool rows to the prompt chat id for the same generation", () => {
		const chatId = "5838f384-e543-41e8-be49-57fb1de0d433";
		const agentSessionId = "6b74a2c7-5d30-4160-8b01-e8106e144ff3";
		const generationId = "e972af4d-ba8b-4d82-a839-b3b0a9b2aafd";

		const rows = [
			{
				source: "cursor",
				kind: "prompt",
				conversation_id: chatId,
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "cursor",
				kind: "agent_tool",
				conversation_id: agentSessionId,
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "cursor",
				kind: "shell",
				conversation_id: agentSessionId,
				generation_id: generationId,
				attributes_json: null,
			},
		];

		const out = reconcileCursorActivityConversationIds(rows);
		expect(out[0]!.conversation_id).toBe(chatId);
		expect(out[1]!.conversation_id).toBe(chatId);
		expect(out[2]!.conversation_id).toBe(chatId);
	});

	it("learns chat id from transcript_path on stop when prompt is absent", () => {
		const chatId = "5838f384-e543-41e8-be49-57fb1de0d433";
		const generationId = "gen-1";
		const transcript = `/home/.cursor/projects/p/agent-transcripts/${chatId}/t.jsonl`;

		const rows = [
			{
				source: "cursor",
				kind: "stop",
				conversation_id: chatId,
				generation_id: generationId,
				attributes_json: JSON.stringify({ transcript_path: transcript }),
			},
			{
				source: "cursor",
				kind: "agent_tool",
				conversation_id: "agent-session",
				generation_id: generationId,
				attributes_json: null,
			},
		];

		const out = reconcileCursorActivityConversationIds(rows);
		expect(out[1]!.conversation_id).toBe(chatId);
	});

	it("does not rewrite when the same generation_id maps to conflicting chat ids", () => {
		const generationId = "gen-1";
		const rows = [
			{
				source: "cursor",
				kind: "prompt",
				conversation_id: "chat-a",
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "cursor",
				kind: "prompt",
				conversation_id: "chat-b",
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "cursor",
				kind: "agent_tool",
				conversation_id: "agent-session",
				generation_id: generationId,
				attributes_json: null,
			},
		];
		const out = reconcileCursorActivityConversationIds(rows);
		expect(out[2]!.conversation_id).toBe("agent-session");
	});

	it("does not rewrite rows with no generation anchor", () => {
		const rows = [
			{
				source: "claude-code",
				kind: "shell",
				conversation_id: "sess-a",
				generation_id: "gen-1",
				attributes_json: null,
			},
		];
		expect(reconcileCursorActivityConversationIds(rows)[0]!.conversation_id).toBe(
			"sess-a",
		);
	});

	it("rewrites sibling spans in the same generation (any source)", () => {
		const chatId = "bfe7fd7c-8704-4570-819e-822c32e0355e";
		const agentSessionId = "34e18a5e-0089-4d8c-b367-df67c590f9b4";
		const generationId = "53c2f1e0-f1cd-4f67-86c0-785679f38ba9";

		const rows = [
			{
				source: "cursor",
				kind: "prompt",
				conversation_id: chatId,
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "cursor",
				kind: "shell",
				conversation_id: agentSessionId,
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "Cursor",
				kind: "call_tool",
				conversation_id: agentSessionId,
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "shell",
				kind: "tool",
				conversation_id: agentSessionId,
				generation_id: generationId,
				attributes_json: null,
			},
		];

		const out = reconcileCursorActivityConversationIds(rows);
		expect(out.map((row) => row.conversation_id)).toEqual([
			chatId,
			chatId,
			chatId,
			chatId,
		]);
	});

	it('does not rewrite rows from another source when generation_id collides', () => {
		const generationId = "gen-collision";
		const rows = [
			{
				source: "cursor",
				kind: "prompt",
				conversation_id: "chat-a",
				generation_id: generationId,
				attributes_json: null,
			},
			{
				source: "claude-code",
				kind: "shell",
				conversation_id: "sess-b",
				generation_id: generationId,
				attributes_json: null,
			},
		];

		const out = reconcileCursorActivityConversationIds(rows);
		expect(out[1]!.conversation_id).toBe("sess-b");
	});
});
