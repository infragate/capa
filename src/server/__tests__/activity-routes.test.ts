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
			capsWatcher: { watchProject: async () => {} } as CapabilitiesFileWatcher,
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

	it("returns 204 when agentActivity is disabled", async () => {
		writeFileSync(
			join(dir, "capabilities.yaml"),
			[
				"providers: [cursor]",
				"options:",
				"  toolExposure: on-demand",
				"  agentActivity: false",
				"skills: []",
			].join("\n"),
		);
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
});
