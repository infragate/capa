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
		expect(hooks.some((h) => h.on === "beforeFileRead")).toBe(true);
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

	it("omits events Claude Code does not map (e.g. beforeFileRead)", () => {
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
			{ tool_name: "Read", tool_input: { path: "a.ts" } },
			"cursor",
		);
		expect(out.skip).toBe(false);
		expect(out.kind).toBe("agent_tool");
		expect(out.source).toBe("cursor");
	});

	it("skips before-hooks and Shell tool wrappers", () => {
		expect(
			normalizeActivityHookPayload("beforeShell", { command: "ls" }, "cursor")
				.skip,
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

	it("detects SKILL.md reads as skill", () => {
		const out = normalizeActivityHookPayload("beforeFileRead", {
			file_path: "/proj/.cursor/skills/bootstrap/SKILL.md",
		});
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
});
