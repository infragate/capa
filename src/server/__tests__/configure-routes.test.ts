import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import type { Capabilities } from "../../types/capabilities";
import { afterWrite, type CapabilitiesRouteDeps } from "../capabilities-route-helpers";
import type { CapabilitiesFileWatcher } from "../capabilities-watcher";
import {
	handleProjectConfigure,
	type ConfigureRouteDeps,
} from "../configure-routes";
import type { CapaMCPServer } from "../mcp-handler";
import { handleGetServerTools } from "../mcp-meta-routes";
import { McpServerStateManager } from "../mcp-server-state";
import type { OAuth2Manager } from "../oauth-manager";
import { SessionManager } from "../session-manager";

const DISK_CAPS = `providers: []
servers:
  - id: safe
    type: mcp
    def:
      cmd: echo
      args: ["ok"]
tools: []
skills: []
`;

const ATTACK_BODY: Capabilities = {
	providers: [],
	skills: [],
	tools: [],
	servers: [
		{
			id: "pwn",
			type: "mcp",
			def: { cmd: "touch", args: ["/tmp/capa-pwned"] },
		},
	],
};

describe("handleProjectConfigure", () => {
	let dir: string;
	let db: CapaDatabase;
	let sessionManager: SessionManager;
	let validatedCmds: string[];
	let deps: ConfigureRouteDeps;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-configure-sec-"));
		writeFileSync(join(dir, "capabilities.yaml"), DISK_CAPS);
		db = new CapaDatabase(join(dir, "test.db"));
		db.upsertProject({ id: "proj-1", path: dir });
		sessionManager = new SessionManager(db);
		validatedCmds = [];
		const mcp = {
			validateTools: async (caps: Capabilities) => {
				for (const server of caps.servers) {
					if (server.def?.cmd) validatedCmds.push(server.def.cmd);
				}
				return [];
			},
		} as unknown as CapaMCPServer;
		deps = {
			db,
			sessionManager,
			oauth2Manager: {
				detectOAuth2Requirement: async () => null,
				isServerConnected: () => false,
				getAccessToken: async () => null,
			} as unknown as OAuth2Manager,
			capsWatcher: {
				watchProject: async () => {},
			} as unknown as CapabilitiesFileWatcher,
			effectiveCapsCache: new Map(),
			getOrCreateMCPServer: () => mcp,
			uiOrigin: () => "http://127.0.0.1:5912",
		};
	});

	afterEach(() => {
		sessionManager.dispose();
		db.close();
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Windows may keep the sqlite handle briefly; ignore cleanup races.
		}
	});

	it("rejects a non-object capabilities body with 400 and does not spawn", async () => {
		const res = await handleProjectConfigure(
			deps,
			"proj-1",
			new Request("http://127.0.0.1/api/projects/proj-1/configure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(["not", "a", "document"]),
			}),
		);
		expect(res.status).toBe(400);
		expect(validatedCmds).toEqual([]);
	});

	it("does not spawn stdio commands from the request body", async () => {
		const res = await handleProjectConfigure(
			deps,
			"proj-1",
			new Request("http://127.0.0.1/api/projects/proj-1/configure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(ATTACK_BODY),
			}),
		);
		expect(res.status).toBe(200);
		expect(validatedCmds).toEqual(["echo"]);
		expect(validatedCmds).not.toContain("touch");
	});

	it("overlays non-empty providers from the request onto on-disk caps", async () => {
		const res = await handleProjectConfigure(
			deps,
			"proj-1",
			new Request("http://127.0.0.1/api/projects/proj-1/configure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					providers: ["cursor"],
					skills: [],
					tools: [],
					servers: [],
				}),
			}),
		);
		expect(res.status).toBe(200);
		const caps = sessionManager.getProjectCapabilities("proj-1");
		expect(caps?.providers).toEqual(["cursor"]);
		expect(caps?.servers.map((s) => s.id)).toEqual(["safe"]);
	});

	it("does not clear on-disk providers when the request sends an empty list", async () => {
		writeFileSync(
			join(dir, "capabilities.yaml"),
			`providers: [cursor]
servers:
  - id: safe
    type: mcp
    def:
      cmd: echo
tools: []
skills: []
`,
		);
		const res = await handleProjectConfigure(
			deps,
			"proj-1",
			new Request("http://127.0.0.1/api/projects/proj-1/configure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(ATTACK_BODY),
			}),
		);
		expect(res.status).toBe(200);
		const caps = sessionManager.getProjectCapabilities("proj-1");
		expect(caps?.providers).toEqual(["cursor"]);
		expect(validatedCmds).toEqual(["echo"]);
	});
});

describe("afterWrite HTTP capability mutations", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-afterwrite-sec-"));
		writeFileSync(join(dir, "capabilities.yaml"), DISK_CAPS);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("refreshes capabilities without running full configure/spawn", async () => {
		let configured = 0;
		let refreshed = 0;
		const deps = {
			configure: async () => {
				configured++;
				return {};
			},
			refreshCapabilities: async () => {
				refreshed++;
				return { success: true };
			},
		} as unknown as CapabilitiesRouteDeps;

		const res = await afterWrite(
			deps,
			"proj-1",
			join(dir, "capabilities.yaml"),
			"yaml",
		);
		expect(res.status).toBe(200);
		expect(configured).toBe(0);
		expect(refreshed).toBe(1);
	});
});

describe("handleGetServerTools", () => {
	it("returns empty tools when the server is not enabled", async () => {
		const mcp = {
			listServerTools: async () => {
				throw new Error("should not connect when disabled");
			},
		} as unknown as CapaMCPServer;
		const sessionManager = {
			getProjectCapabilities: () => ATTACK_BODY,
		};
		const mcpServerState = new McpServerStateManager();

		const res = await handleGetServerTools(
			{
				db: {} as CapaDatabase,
				sessionManager: sessionManager as unknown as SessionManager,
				getOrCreateMCPServer: () => mcp,
				mcpServerState,
			},
			"proj-1",
			"pwn",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.tools).toEqual([]);
		expect(body.enabled).toBe(false);
	});

	it("connects and lists tools when the server is enabled", async () => {
		const listOpts: Array<Record<string, unknown> | undefined> = [];
		const mcp = {
			listServerTools: async (
				_id: string,
				_caps: Capabilities,
				opts?: Record<string, unknown>,
			) => {
				listOpts.push(opts);
				return [{ name: "tool-a" }];
			},
		} as unknown as CapaMCPServer;
		const sessionManager = {
			getProjectCapabilities: () => ATTACK_BODY,
		};
		const mcpServerState = new McpServerStateManager();
		mcpServerState.setEnabled("proj-1", "pwn", true);

		const res = await handleGetServerTools(
			{
				db: {} as CapaDatabase,
				sessionManager: sessionManager as unknown as SessionManager,
				getOrCreateMCPServer: () => mcp,
				mcpServerState,
			},
			"proj-1",
			"pwn",
		);
		expect(res.status).toBe(200);
		expect(listOpts[0]?.connect).toBe(true);
		const body = await res.json();
		expect(body.enabled).toBe(true);
		expect(body.tools).toHaveLength(1);
	});
});
