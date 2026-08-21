import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import type { Capabilities } from "../../types/capabilities";
import type { CapabilitiesFileWatcher } from "../capabilities-watcher";
import {
	applyProjectCapabilitiesOnly,
	type ConfigureRouteDeps,
} from "../configure-routes";
import type { CapaMCPServer } from "../mcp-handler";
import type { OAuth2Manager } from "../oauth-manager";
import { SessionManager } from "../session-manager";
import {
	syncProjectManagedArtifacts,
	syncProjectManagedArtifactsAndWrapShadows,
} from "../sync-project-artifacts";
import { getWorkspacesDir, WORKSPACE_MARKER } from "../../shared/workspaces/paths";

function registerWrapShadow(
	realProjectPath: string,
	providerId: string,
): string {
	const cachePath = join(
		getWorkspacesDir(),
		`test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const workspacePath = join(cachePath, "project");
	mkdirSync(join(workspacePath, ".cursor"), { recursive: true });
	writeFileSync(
		join(cachePath, WORKSPACE_MARKER),
		JSON.stringify({
			realProjectPath,
			providerId,
			workingDir: "project",
		}),
		"utf-8",
	);
	return workspacePath;
}

describe("applyProjectCapabilitiesOnly artifact sync", () => {
	let dir: string;
	let db: CapaDatabase;
	let sessionManager: SessionManager;
	let deps: ConfigureRouteDeps;
	const projectId = "proj-hooks-ui";
	let prevHome: string | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-ui-hooks-"));
		prevHome = process.env.HOME;
		const home = mkdtempSync(join(tmpdir(), "capa-ui-home-"));
		process.env.HOME = home;
		process.env.USERPROFILE = home;

		writeFileSync(
			join(dir, "capabilities.yaml"),
			`providers: [claude-code]
hooks: []
`,
		);
		writeFileSync(
			join(dir, "AGENTS.md"),
			"# User-owned instructions\nDo not overwrite.\n",
			"utf-8",
		);
		db = new CapaDatabase(join(dir, "test.db"));
		db.upsertProject({ id: projectId, path: dir });
		db.setProjectProviders(projectId, ["claude-code"]);
		sessionManager = new SessionManager(db);
		deps = {
			db,
			sessionManager,
			oauth2Manager: {} as OAuth2Manager,
			capsWatcher: {
				watchProject: async () => {},
			} as unknown as CapabilitiesFileWatcher,
			effectiveCapsCache: new Map(),
			getOrCreateMCPServer: () =>
				({ disconnectNonEnabledServers: async () => {} }) as unknown as CapaMCPServer,
			uiOrigin: () => "http://127.0.0.1:5912",
		};
	});

	afterEach(() => {
		sessionManager.dispose();
		db.close();
		rmSync(dir, { recursive: true, force: true });
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
	});

	it("does not write hooks or agent files to the source project on UI refresh", async () => {
		const caps: Capabilities = {
			providers: ["claude-code"],
			skills: [],
			tools: [],
			servers: [],
			hooks: [
				{
					id: "audit-bash",
					on: "beforeShell",
					type: "command",
					command: "echo running",
				},
			],
			agents: {
				additional: [
					{
						id: "team-style",
						type: "inline",
						content: "Always write tests first.",
					},
				],
			},
		};

		await applyProjectCapabilitiesOnly(deps, projectId, caps);

		expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);
		expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(
			"# User-owned instructions\nDo not overwrite.\n",
		);
	});

	it("writes hooks and agent snippets to an active wrap shadow on UI refresh", async () => {
		const workspacePath = registerWrapShadow(dir, "cursor");

		db.setProjectProviders(projectId, ["cursor"]);
		writeFileSync(
			join(dir, "capabilities.yaml"),
			`providers: [cursor]
hooks: []
`,
		);

		const caps: Capabilities = {
			providers: ["cursor"],
			skills: [],
			tools: [],
			servers: [],
			hooks: [
				{
					id: "wrap-hook",
					on: "sessionStart",
					type: "command",
					command: "echo wrap",
				},
			],
			agents: {
				additional: [
					{
						id: "team-style",
						type: "inline",
						content: "Always write tests first.",
					},
				],
			},
		};

		await applyProjectCapabilitiesOnly(deps, projectId, caps);

		expect(existsSync(join(dir, ".cursor", "hooks.json"))).toBe(false);
		expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain(
			"User-owned instructions",
		);

		const hooksPath = join(workspacePath, ".cursor", "hooks.json");
		expect(existsSync(hooksPath)).toBe(true);
		const agentsPath = join(workspacePath, "AGENTS.md");
		expect(existsSync(agentsPath)).toBe(true);
		expect(readFileSync(agentsPath, "utf-8")).toContain("team-style");
	});

	it("does not install sub-agents on the source project on UI refresh", async () => {
		db.setProjectProviders(projectId, ["cursor"]);
		const caps: Capabilities = {
			providers: ["cursor"],
			skills: [],
			tools: [],
			servers: [],
			subagents: [
				{
					id: "reviewer",
					description: "Reviews code changes",
					skills: [],
					tools: [],
				},
			],
		};

		await applyProjectCapabilitiesOnly(deps, projectId, caps);

		expect(existsSync(join(dir, ".cursor", "agents", "reviewer.md"))).toBe(
			false,
		);
	});
});

describe("syncProjectManagedArtifacts wrap shadow path", () => {
	let realDir: string;
	let shadowDir: string;
	let db: CapaDatabase;
	let dbPath: string;
	let prevHome: string | undefined;
	const projectId = "proj-wrap-shadow";

	beforeEach(() => {
		prevHome = process.env.HOME;
		const home = mkdtempSync(join(tmpdir(), "capa-wrap-sync-home-"));
		process.env.HOME = home;
		process.env.USERPROFILE = home;

		realDir = mkdtempSync(join(tmpdir(), "capa-wrap-hooks-real-"));
		shadowDir = mkdtempSync(join(tmpdir(), "capa-wrap-hooks-shadow-"));
		mkdirSync(join(shadowDir, ".cursor"), { recursive: true });
		writeFileSync(join(realDir, "capabilities.yaml"), "providers: [cursor]\n");
		dbPath = join(realDir, "test.db");
		db = new CapaDatabase(dbPath);
		db.upsertProject({ id: projectId, path: realDir });
		db.setProjectProviders(projectId, ["cursor"]);
	});

	afterEach(() => {
		db.close();
		rmSync(realDir, { recursive: true, force: true });
		rmSync(shadowDir, { recursive: true, force: true });
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
	});

	it("writes cursor hooks.json under the shadow workspace projectPath", async () => {
		await syncProjectManagedArtifacts({
			projectPath: shadowDir,
			projectId,
			capabilitiesFilePath: join(realDir, "capabilities.yaml"),
			capabilities: {
				providers: ["cursor"],
				skills: [],
				tools: [],
				servers: [],
				hooks: [
					{
						id: "wrap-hook",
						on: "sessionStart",
						type: "command",
						command: "echo wrap",
					},
				],
			},
			db,
			serverOrigin: "http://127.0.0.1:5912",
			providers: ["cursor"],
			pruneOptions: {
				onlyDesiredProviders: true,
				mutateRoot: shadowDir,
			},
			materializeShadow: true,
		});

		const hooksPath = join(shadowDir, ".cursor", "hooks.json");
		expect(existsSync(hooksPath)).toBe(true);
		const parsed = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
			hooks?: { sessionStart?: unknown[] };
		};
		expect(parsed.hooks?.sessionStart?.length).toBeGreaterThan(0);
	});

	it("syncProjectManagedArtifactsAndWrapShadows skips the source project tree", async () => {
		writeFileSync(
			join(realDir, "AGENTS.md"),
			"# User-owned\n",
			"utf-8",
		);

		const result = await syncProjectManagedArtifactsAndWrapShadows({
			projectPath: realDir,
			projectId,
			capabilitiesFilePath: join(realDir, "capabilities.yaml"),
			capabilities: {
				providers: ["cursor"],
				skills: [],
				tools: [],
				servers: [],
				agents: {
					additional: [
						{
							id: "x",
							type: "inline",
							content: "hello",
						},
					],
				},
			},
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(result.skipped).toBe(true);
		expect(readFileSync(join(realDir, "AGENTS.md"), "utf-8")).toBe(
			"# User-owned\n",
		);
	});

	it("warns and continues when a wrap shadow marker references an unknown provider", async () => {
		const cachePath = join(getWorkspacesDir(), `bad-provider-${Date.now()}`);
		const workspacePath = join(cachePath, "project");
		mkdirSync(workspacePath, { recursive: true });
		writeFileSync(
			join(cachePath, WORKSPACE_MARKER),
			JSON.stringify({
				realProjectPath: realDir,
				providerId: "not-a-real-provider",
				workingDir: "project",
			}),
			"utf-8",
		);

		const result = await syncProjectManagedArtifactsAndWrapShadows({
			projectPath: realDir,
			projectId,
			capabilitiesFilePath: join(realDir, "capabilities.yaml"),
			capabilities: {
				providers: ["cursor"],
				skills: [],
				tools: [],
				servers: [],
				hooks: [
					{
						id: "wrap-hook",
						on: "sessionStart",
						type: "command",
						command: "echo wrap",
					},
				],
			},
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(result.hooks.warnings.some((w) => w.includes("unknown provider"))).toBe(
			true,
		);
		expect(result.skipped).toBe(true);
		rmSync(cachePath, { recursive: true, force: true });
	});
});
