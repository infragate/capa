import { describe, expect, it } from "bun:test";
import type { ToolCallRecord } from "../../types/database";
import {
	pickCapaTraceForProviderHook,
	pickUniqueCapaShProviderShellMatch,
	tryLinkCapaShellTraceAfterFinish,
	tryLinkCapaShellTraceFromProviderHook,
} from "../activity-trace-correlate";

function row(
	partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, "id" | "started_at">,
): ToolCallRecord {
	return {
		project_id: "p1",
		session_id: null,
		duration_ms: 1,
		status: "ok",
		source: "cursor",
		kind: "shell",
		tool_name: "capa sh test",
		meta_tool: null,
		args_json: null,
		result_preview: "out",
		result_bytes: null,
		result_tokens: null,
		input_tokens: null,
		output_tokens: null,
		cache_read_tokens: null,
		cache_write_tokens: null,
		error_message: null,
		agent_id: null,
		conversation_id: "conv-1",
		generation_id: "gen-1",
		model: null,
		attributes_json: null,
		...partial,
	};
}

function mockDb(
	overrides: Partial<
		import("../activity-trace-correlate").ActivityTraceCorrelateDb
	>,
) {
	return {
		findUncorrelatedCapaShellTracesInWindow: () => [],
		findProviderCapaShHooksInWindow: () => [],
		patchToolCallCorrelation: () => null,
		...overrides,
	};
}

describe("activity-trace-correlate", () => {
	it("pickUniqueCapaShProviderShellMatch rejects ambiguous capa sh hooks", () => {
		const a = row({ id: "a", started_at: 1, tool_name: "capa sh a" });
		const b = row({ id: "b", started_at: 2, tool_name: "capa sh b" });
		expect(pickUniqueCapaShProviderShellMatch([a, b])).toBeNull();
		expect(pickUniqueCapaShProviderShellMatch([a])).toBe(a);
	});

	it("links capa shell trace by capa sh command when outputs differ", () => {
		const hook = row({
			id: "hook",
			started_at: 1_000_908,
			tool_name:
				"capa sh pagerduty list-incidents --statuses triggered --limit 5",
			conversation_id: "chat-a",
			generation_id: "turn-1",
			result_preview: "Traceback (shell wrapper)",
		});
		const capa = row({
			id: "capa",
			started_at: 1_000_000,
			source: "shell",
			kind: "tool",
			tool_name: "pagerduty.list_incidents",
			conversation_id: null,
			generation_id: null,
			result_preview: "Error executing tool list_incidents: validation",
		});

		const patches: Array<{ id: string; conversation_id: string }> = [];
		const db = mockDb({
			findProviderCapaShHooksInWindow: () => [hook],
			patchToolCallCorrelation: (id, corr) => {
				patches.push({ id, conversation_id: corr.conversation_id });
				return {
					...capa,
					conversation_id: corr.conversation_id,
					generation_id: corr.generation_id,
				};
			},
		});

		const linked = tryLinkCapaShellTraceAfterFinish(db, capa);
		expect(linked?.conversation_id).toBe("chat-a");
		expect(linked?.generation_id).toBe("turn-1");
		expect(patches).toHaveLength(1);

		const capaOnly = row({
			id: "capa2",
			started_at: 1_000_000,
			source: "shell",
			kind: "tool",
			tool_name: "pagerduty.list_incidents",
			conversation_id: null,
		});
		const dbHookFirst = mockDb({
			findUncorrelatedCapaShellTracesInWindow: () => [capaOnly],
			patchToolCallCorrelation: (id, corr) => ({
				...capaOnly,
				conversation_id: corr.conversation_id,
				generation_id: corr.generation_id,
			}),
		});
		const fromHook = tryLinkCapaShellTraceFromProviderHook(dbHookFirst, hook);
		expect(fromHook?.conversation_id).toBe("chat-a");
	});

	it("leaves capa shell traces uncorrelated when no capa sh hook matches", () => {
		const capa = row({
			id: "capa",
			started_at: 1000,
			source: "shell",
			kind: "tool",
			tool_name: "glean.search",
			conversation_id: null,
			generation_id: null,
		});

		const db = mockDb({
			findProviderCapaShHooksInWindow: () => [],
		});

		expect(tryLinkCapaShellTraceAfterFinish(db, capa)).toBeNull();
	});

	it("pickCapaTraceForProviderHook prefers latest capa trace before hook", () => {
		const hook = row({
			id: "h",
			started_at: 2000,
			tool_name: "capa sh pagerduty get-alerts",
		});
		const older = row({
			id: "old",
			started_at: -100,
			source: "shell",
			kind: "tool",
			tool_name: "pagerduty.get_alerts",
			conversation_id: null,
		});
		const best = row({
			id: "best",
			started_at: 1900,
			source: "shell",
			kind: "tool",
			tool_name: "pagerduty.get_alerts",
			conversation_id: null,
		});
		expect(pickCapaTraceForProviderHook(hook, [older, best])?.id).toBe("best");
	});
});
