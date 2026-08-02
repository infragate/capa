import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import { initSchema } from "../../db/schema";
import { syncSystemActivityHooks } from "../agent-activity-sync";
import { SYSTEM_ACTIVITY_HOOK_PREFIX } from "../agent-activity";
import type { Capabilities } from "../../types/capabilities";

describe("syncSystemActivityHooks", () => {
	let dir: string;
	let db: CapaDatabase;
	let capsPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-activity-hooks-"));
		mkdirSync(join(dir, ".cursor"), { recursive: true });
		capsPath = join(dir, "capabilities.yaml");
		writeFileSync(
			capsPath,
			["providers:", "  - cursor", "options:", "  toolExposure: on-demand", "skills: []"].join(
				"\n",
			),
		);
		const sqlite = new Database(join(dir, "test.db"), { create: true });
		initSchema(sqlite);
		sqlite.close();
		db = new CapaDatabase(join(dir, "test.db"));
		db.upsertProject({ id: "proj-act", path: dir });
		db.setProjectProviders("proj-act", ["cursor"]);
	});

	afterEach(() => {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("injects capa-sys-activity hooks into Cursor hooks.json when enabled", async () => {
		const caps: Capabilities = {
			providers: ["cursor"],
			options: { toolExposure: "on-demand" },
			skills: [],
			servers: [],
			tools: [],
		};
		const result = await syncSystemActivityHooks({
			projectPath: dir,
			projectId: "proj-act",
			capabilitiesFilePath: capsPath,
			capabilities: caps,
			providers: ["cursor"],
			db,
		});
		expect(result.enabled).toBe(true);
		expect(result.installed).toBeGreaterThan(0);

		const hooksPath = join(dir, ".cursor", "hooks.json");
		expect(existsSync(hooksPath)).toBe(true);
		const config = JSON.parse(readFileSync(hooksPath, "utf8")) as {
			hooks: Record<string, Array<{ name?: string; command?: string }>>;
		};
		const flat = Object.values(config.hooks).flat();
		const sys = flat.filter((e) => e.name?.includes("capa-sys-activity"));
		expect(sys.length).toBeGreaterThan(0);
		expect(sys.some((e) => e.command?.includes("capa activity-ingest"))).toBe(
			true,
		);

		const managed = db.getManagedHooks("proj-act");
		expect(
			managed.some((m) => m.hookId.startsWith(SYSTEM_ACTIVITY_HOOK_PREFIX)),
		).toBe(true);
	});

	it("prunes system activity hooks when disabled", async () => {
		const capsOn: Capabilities = {
			providers: ["cursor"],
			options: { agentActivity: true },
			skills: [],
			servers: [],
			tools: [],
		};
		await syncSystemActivityHooks({
			projectPath: dir,
			projectId: "proj-act",
			capabilitiesFilePath: capsPath,
			capabilities: capsOn,
			providers: ["cursor"],
			db,
		});

		const capsOff: Capabilities = {
			providers: ["cursor"],
			options: { agentActivity: false },
			skills: [],
			servers: [],
			tools: [],
		};
		const result = await syncSystemActivityHooks({
			projectPath: dir,
			projectId: "proj-act",
			capabilitiesFilePath: capsPath,
			capabilities: capsOff,
			providers: ["cursor"],
			db,
		});
		expect(result.enabled).toBe(false);
		expect(result.removed).toBeGreaterThan(0);

		const managed = db.getManagedHooks("proj-act");
		expect(
			managed.some((m) => m.hookId.startsWith(SYSTEM_ACTIVITY_HOOK_PREFIX)),
		).toBe(false);
	});
});
