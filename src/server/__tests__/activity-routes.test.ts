import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import { SessionManager } from "../session-manager";
import { ToolCallTracer } from "../tool-call-tracer";
import { handlePostProjectActivityEvent } from "../activity-routes";
import type { ProjectRouteDeps } from "../project-routes";
import type { CapabilitiesFileWatcher } from "../capabilities-watcher";
import type { OAuth2Manager } from "../oauth-manager";
import type { ConfigureRouteDeps } from "../configure-routes";

describe("handlePostProjectActivityEvent", () => {
	let dir: string;
	let db: CapaDatabase;
	let sessionManager: SessionManager;
	let tracer: ToolCallTracer;
	let deps: ProjectRouteDeps & { toolCallTracer: ToolCallTracer };

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-activity-ingest-"));
		writeFileSync(
			join(dir, "capabilities.yaml"),
			["providers: [cursor]", "options:", "  toolExposure: on-demand", "skills: []"].join(
				"\n",
			),
		);
		db = new CapaDatabase(join(dir, "test.db"));
		db.upsertProject({ id: "proj-1", path: dir });
		sessionManager = new SessionManager(db);
		sessionManager.setProjectCapabilities("proj-1", {
			providers: ["cursor"],
			options: { toolExposure: "on-demand" },
			skills: [],
			servers: [],
			tools: [],
		});
		tracer = new ToolCallTracer(db);
		deps = {
			db,
			sessionManager,
			oauth2Manager: {} as OAuth2Manager,
			capsWatcher: { watchProject: async () => {} } as unknown as CapabilitiesFileWatcher,
			effectiveCapsCache: new Map(),
			projectEventClients: new Map(),
			configureDeps: {} as ConfigureRouteDeps,
			toolCallTracer: tracer,
		};
	});

	afterEach(() => {
		sessionManager.dispose();
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("inserts an activity row when enabled", async () => {
		const res = await handlePostProjectActivityEvent(
			deps,
			"proj-1",
			new Request("http://localhost/api/projects/proj-1/activity/events", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "shell",
					toolName: "echo hi",
					status: "ok",
					source: "cursor",
					args: { command: "echo hi" },
				}),
			}),
		);
		expect(res.status).toBe(201);
		const page = db.listToolCalls("proj-1", { limit: 10 });
		expect(page.calls.length).toBe(1);
		expect(page.calls[0].kind).toBe("shell");
		expect(page.calls[0].tool_name).toBe("echo hi");
		expect(page.calls[0].source).toBe("cursor");
	});

	it("persists provider token usage on stop events", async () => {
		const res = await handlePostProjectActivityEvent(
			deps,
			"proj-1",
			new Request("http://localhost/api/projects/proj-1/activity/events", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "stop",
					toolName: "stop",
					status: "ok",
					source: "cursor",
					tokenUsage: {
						input_tokens: 100,
						output_tokens: 20,
						cache_read_tokens: 80,
						cache_write_tokens: 5,
					},
				}),
			}),
		);
		expect(res.status).toBe(201);
		const row = db.listToolCalls("proj-1", { limit: 1 }).calls[0];
		expect(row.kind).toBe("stop");
		expect(row.input_tokens).toBe(100);
		expect(row.output_tokens).toBe(20);
		expect(row.cache_read_tokens).toBe(80);
		expect(row.cache_write_tokens).toBe(5);
	});

	it("persists conversation and generation ids", async () => {
		const res = await handlePostProjectActivityEvent(
			deps,
			"proj-1",
			new Request("http://localhost/x", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "agent_tool",
					toolName: "Read",
					status: "ok",
					source: "cursor",
					conversationId: "conv-abc",
					generationId: "gen-xyz",
					model: "claude-opus-4",
					attributes: {
						model: "claude-opus-4",
						model_id: "claude-opus-4-7",
						provider_version: "1.7.2",
					},
				}),
			}),
		);
		expect(res.status).toBe(201);
		const row = db.listToolCalls("proj-1", { limit: 1 }).calls[0];
		expect(row.conversation_id).toBe("conv-abc");
		expect(row.generation_id).toBe("gen-xyz");
		expect(row.model).toBe("claude-opus-4");
		expect(JSON.parse(row.attributes_json!)).toEqual({
			model: "claude-opus-4",
			model_id: "claude-opus-4-7",
			provider_version: "1.7.2",
		});
	});

	it("does not inherit another provider's conversation when ids are missing", async () => {
		db.insertToolCall({
			id: "claude-1",
			project_id: "proj-1",
			session_id: null,
			started_at: Date.now() - 1_000,
			duration_ms: 10,
			status: "ok",
			source: "claude-code",
			kind: "session",
			tool_name: "sessionStart",
			meta_tool: null,
			args_json: "{}",
			result_preview: null,
			result_bytes: null,
			result_tokens: null,
			error_message: null,
			agent_id: null,
			conversation_id: "conv-claude",
			generation_id: "gen-claude",
		});

		const res = await handlePostProjectActivityEvent(
			deps,
			"proj-1",
			new Request("http://localhost/x", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "session",
					toolName: "sessionStart",
					status: "ok",
					source: "cursor",
				}),
			}),
		);
		expect(res.status).toBe(201);
		const row = db.listToolCalls("proj-1", { limit: 1 }).calls[0];
		expect(row.source).toBe("cursor");
		expect(row.conversation_id).toBeNull();
		expect(row.generation_id).toBeNull();
	});

	it("returns 204 when agentActivity is disabled", async () => {
		// Session caps are the fast path; disk is not consulted when session is warm.
		sessionManager.setProjectCapabilities("proj-1", {
			providers: ["cursor"],
			options: { agentActivity: false },
			skills: [],
			servers: [],
			tools: [],
		});

		const res = await handlePostProjectActivityEvent(
			deps,
			"proj-1",
			new Request("http://localhost/x", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "shell",
					toolName: "echo hi",
					status: "ok",
				}),
			}),
		);
		expect(res.status).toBe(204);
		expect(db.listToolCalls("proj-1", { limit: 10 }).calls.length).toBe(0);
	});

	it("falls back to disk when session capabilities are missing", async () => {
		const diskDir = mkdtempSync(join(tmpdir(), "capa-activity-disk-"));
		try {
			writeFileSync(
				join(diskDir, "capabilities.yaml"),
				[
					"providers: [cursor]",
					"options:",
					"  toolExposure: on-demand",
					"  agentActivity: false",
					"skills: []",
				].join("\n"),
			);
			db.upsertProject({ id: "proj-disk-only", path: diskDir });
			const res = await handlePostProjectActivityEvent(
				deps,
				"proj-disk-only",
				new Request("http://localhost/x", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						kind: "shell",
						toolName: "echo hi",
						status: "ok",
					}),
				}),
			);
			expect(res.status).toBe(204);
		} finally {
			rmSync(diskDir, { recursive: true, force: true });
		}
	});
});
