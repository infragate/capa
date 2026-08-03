import { describe, expect, it } from "bun:test";
import {
	buildSystemActivityHooks,
	isAgentActivityEnabled,
	isSystemActivityHookId,
	SYSTEM_ACTIVITY_HOOK_PREFIX,
} from "../agent-activity";
import { normalizeActivityHookPayload } from "../agent-activity-normalize";

describe("agent-activity helpers", () => {
	it("defaults agentActivity to enabled", () => {
		expect(isAgentActivityEnabled(undefined)).toBe(true);
		expect(isAgentActivityEnabled({})).toBe(true);
		expect(isAgentActivityEnabled({ agentActivity: true })).toBe(true);
		expect(isAgentActivityEnabled({ agentActivity: false })).toBe(false);
	});

	it("builds portable capa activity-ingest commands", () => {
		const hooks = buildSystemActivityHooks("my-project", "cursor");
		expect(hooks.length).toBeGreaterThan(5);
		expect(hooks.some((h) => h.on === "beforeTool")).toBe(false);
		expect(hooks.some((h) => h.on === "beforeShell")).toBe(false);
		expect(hooks.some((h) => h.on === "afterShell")).toBe(true);
		expect(hooks.some((h) => h.on === "afterTool")).toBe(true);
		expect(hooks.some((h) => h.on === "beforeFileRead")).toBe(false);
		expect(hooks.some((h) => h.on === "afterFileEdit")).toBe(true);
		for (const h of hooks) {
			expect(isSystemActivityHookId(h.id)).toBe(true);
			expect(h.id.startsWith(SYSTEM_ACTIVITY_HOOK_PREFIX)).toBe(true);
			expect(h.command).toContain("capa activity-ingest");
			expect(h.command).toContain("--project my-project");
			expect(h.command).toContain("--provider cursor");
			expect(h.command).toContain(`--event ${h.on}`);
			expect(h.failClosed).toBeUndefined();
		}
	});

	it("omits events Claude Code does not map", () => {
		const hooks = buildSystemActivityHooks("my-project", "claude-code");
		expect(hooks.some((h) => h.on === "afterTool")).toBe(true);
		expect(hooks.some((h) => h.on === "afterToolFailure")).toBe(true);
		expect(hooks.some((h) => h.on === "subagentStart")).toBe(true);
		expect(hooks.some((h) => h.on === "beforeFileRead")).toBe(false);
		for (const h of hooks) {
			expect(h.command).toContain("--provider claude-code");
		}
	});
});

describe("normalizeActivityHookPayload", () => {
	it("maps shell events", () => {
		const out = normalizeActivityHookPayload(
			"afterShell",
			{ command: "ls -la", cwd: "/tmp" },
			"cursor",
		);
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("shell");
		expect(out.toolName).toBe("ls -la");
		expect(out.source).toBe("cursor");
	});

	it("uses provider hint when payload has no provider field", () => {
		const out = normalizeActivityHookPayload(
			"afterTool",
			{
				tool_name: "Read",
				tool_input: { path: "a.ts" },
				conversation_id: "c1",
				generation_id: "g1",
			},
			"cursor",
		);
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("agent_tool");
		expect(out.source).toBe("cursor");
		expect(out.conversationId).toBe("c1");
		expect(out.generationId).toBe("g1");
	});

	it("skips before-hooks and Shell tool wrappers", () => {
		expect(
			normalizeActivityHookPayload("beforeShell", { command: "ls" }, "cursor")
				.skip,
		).toBe(true);
		expect(
			normalizeActivityHookPayload(
				"beforeFileRead",
				{ file_path: "/proj/a.ts" },
				"cursor",
			).skip,
		).toBe(true);
		expect(
			normalizeActivityHookPayload(
				"afterTool",
				{ tool_name: "Shell", tool_input: { command: "ls" } },
				"cursor",
			).skip,
		).toBe(true);
	});

	it("skips capa sh shell rows (MCP tracer owns the tool call)", () => {
		expect(
			normalizeActivityHookPayload(
				"afterShell",
				{ command: "capa sh owl check-consistency" },
				"cursor",
			).skip,
		).toBe(true);
	});

	it("maps prompts", () => {
		const out = normalizeActivityHookPayload("userPromptSubmit", {
			prompt: "Please fix the bug in auth",
		});
		expect(out.kind).toBe("prompt");
		expect(out.toolName).toContain("Please fix");
	});

	it("detects SKILL.md reads as skill via afterTool", () => {
		const out = normalizeActivityHookPayload("afterTool", {
			tool_name: "Read",
			tool_input: { path: "/proj/.cursor/skills/bootstrap/SKILL.md" },
		});
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("skill");
		expect(out.toolName).toBe("bootstrap");
	});

	it("dedups capa MCP payloads", () => {
		const out = normalizeActivityHookPayload("afterMcpCall", {
			url: "http://127.0.0.1:5912/myproj/mcp",
			tool_name: "call_tool",
		});
		expect(out.skip).toBe(true);
	});

	it("does not treat third-party /mcp URLs as capa MCP", () => {
		const out = normalizeActivityHookPayload("afterMcpCall", {
			url: "http://localhost:3000/mcp",
			tool_name: "search",
			server: "brave",
		});
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("agent_mcp");
	});

	it("dedups Claude-style mcp__capa tools", () => {
		const out = normalizeActivityHookPayload("afterTool", {
			tool_name: "mcp__capa__setup_tools",
			tool_input: {},
		});
		expect(out.skip).toBe(true);
	});

	it("skips capa MCP payloads that only nest under mcpServers.capa", () => {
		const out = normalizeActivityHookPayload("afterMcpCall", {
			tool_name: "list_tools",
			mcpServers: { capa: { url: "http://127.0.0.1:5912/p/mcp" } },
		});
		expect(out.skip).toBe(true);
	});

	it("does not stringify large unrelated fields when detecting capa MCP", () => {
		const huge = "x".repeat(200_000);
		const out = normalizeActivityHookPayload("afterMcpCall", {
			tool_name: "brave_search",
			server: "brave",
			transcript: huge,
		});
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("agent_mcp");
	});

	it("extracts Cursor stop token usage", () => {
		const out = normalizeActivityHookPayload(
			"stop",
			{
				status: "completed",
				model: "composer-1.5",
				input_tokens: 191551,
				output_tokens: 1789,
				cache_read_tokens: 176032,
				cache_write_tokens: 0,
			},
			"cursor",
		);
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("stop");
		expect(out.tokenUsage).toEqual({
			input_tokens: 191551,
			output_tokens: 1789,
			cache_read_tokens: 176032,
			cache_write_tokens: 0,
		});
		expect(out.args).toMatchObject({
			status: "completed",
			model: "composer-1.5",
			usage: {
				input_tokens: 191551,
				output_tokens: 1789,
				cache_read_tokens: 176032,
				cache_write_tokens: 0,
			},
		});
	});

	it("reads nested usage objects", () => {
		const out = normalizeActivityHookPayload(
			"stop",
			{
				usage: {
					input_tokens: 10,
					output_tokens: 4,
					cache_read_input_tokens: 8,
				},
			},
			"claude-code",
		);
		expect(out.tokenUsage).toEqual({
			input_tokens: 10,
			output_tokens: 4,
			cache_read_tokens: 8,
			cache_write_tokens: null,
		});
	});
});
