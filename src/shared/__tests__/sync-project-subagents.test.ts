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
import { canonicalizePath } from "../paths";
import type { Capabilities } from "../../types/capabilities";
import { syncProjectSubagents } from "../sync-project-subagents";

const projectId = "subagent-targeting-project";
const activeProviders = ["claude-code", "codex", "cursor", "gemini-cli"];

function capabilities(targets: string[]): Capabilities {
	return {
		providers: activeProviders,
		options: { toolExposure: "none" },
		skills: [],
		servers: [],
		tools: [],
		subagents: [
			{
				id: "reviewer",
				description: "Reviews changes",
				providers: targets,
				skills: [],
				tools: [],
			},
		],
	};
}

describe("syncProjectSubagents provider targeting", () => {
	let projectPath: string;
	let db: CapaDatabase;

	beforeEach(() => {
		projectPath = mkdtempSync(join(tmpdir(), "capa-subagent-targeting-"));
		db = new CapaDatabase(join(projectPath, "capa.db"));
		db.upsertProject({ id: projectId, path: projectPath });
	});

	afterEach(() => {
		db.close();
		rmSync(projectPath, { recursive: true, force: true });
	});

	it("writes only allow-listed adapters and preserves excluded manual files", async () => {
		const manualCodexPath = join(projectPath, ".codex", "agents", "reviewer.toml");
		mkdirSync(join(projectPath, ".codex", "agents"), { recursive: true });
		writeFileSync(manualCodexPath, "manual = true\n", "utf-8");

		const result = await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["claude-code"]),
			providers: activeProviders,
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(result).toEqual({ installed: 1, removed: 0, warnings: [] });
		expect(existsSync(join(projectPath, ".claude", "agents", "reviewer.md"))).toBe(
			true,
		);
		expect(readFileSync(manualCodexPath, "utf-8")).toBe("manual = true\n");
		expect(existsSync(join(projectPath, ".cursor", "agents", "reviewer.md"))).toBe(
			false,
		);
		expect(existsSync(join(projectPath, ".gemini", "agents", "reviewer.md"))).toBe(
			false,
		);
		expect(db.getSubAgents(projectId)[0].installations).toEqual([
			{
				install_path: canonicalizePath(projectPath),
				provider_ids: ["claude-code"],
			},
		]);
	});

	it("removes the old Capa adapter when the allow-list changes", async () => {
		await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["cursor"]),
			providers: activeProviders,
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});
		expect(existsSync(join(projectPath, ".cursor", "agents", "reviewer.md"))).toBe(
			true,
		);

		await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["gemini-cli"]),
			providers: activeProviders,
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(existsSync(join(projectPath, ".cursor", "agents", "reviewer.md"))).toBe(
			false,
		);
		expect(existsSync(join(projectPath, ".gemini", "agents", "reviewer.md"))).toBe(
			true,
		);
		expect(db.getSubAgents(projectId)[0].installations[0].provider_ids).toEqual([
			"gemini-cli",
		]);
	});

	it("preserves a stale adapter that was replaced manually", async () => {
		const cursorPath = join(projectPath, ".cursor", "agents", "reviewer.md");
		await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["cursor"]),
			providers: activeProviders,
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});
		writeFileSync(cursorPath, "manual replacement\n", "utf-8");

		await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["gemini-cli"]),
			providers: activeProviders,
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(readFileSync(cursorPath, "utf-8")).toBe("manual replacement\n");
		expect(
			existsSync(join(projectPath, ".gemini", "agents", "reviewer.md")),
		).toBe(true);
	});

	it("cleans historical providers before scoping legacy ownership", async () => {
		const claudePath = join(projectPath, ".claude", "agents", "reviewer.md");
		const cursorPath = join(projectPath, ".cursor", "agents", "reviewer.md");
		mkdirSync(join(projectPath, ".claude", "agents"), { recursive: true });
		mkdirSync(join(projectPath, ".cursor", "agents"), { recursive: true });
		for (const filePath of [claudePath, cursorPath]) {
			writeFileSync(
				filePath,
				'**MCP server key:** `capa-reviewer`\n',
				"utf-8",
			);
		}
		db.setProjectProviders(projectId, ["claude-code", "cursor"]);
		db.upsertSubAgent(projectId, "reviewer");

		await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["gemini-cli"]),
			providers: ["gemini-cli"],
			previousProviders: ["claude-code", "cursor"],
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(existsSync(claudePath)).toBe(false);
		expect(existsSync(cursorPath)).toBe(false);
		expect(
			existsSync(join(projectPath, ".gemini", "agents", "reviewer.md")),
		).toBe(true);
		expect(db.getSubAgents(projectId)[0]).toMatchObject({
			legacy_unscoped: false,
			installations: [
				{
					provider_ids: ["gemini-cli"],
				},
			],
		});
	});

	it("warns and skips an active provider without sub-agent support", async () => {
		const result = await syncProjectSubagents({
			projectPath,
			projectId,
			capabilities: capabilities(["crush"]),
			providers: ["crush"],
			db,
			serverOrigin: "http://127.0.0.1:5912",
		});

		expect(result.installed).toBe(0);
		expect(result.warnings).toEqual([
			'Sub-agent "reviewer": provider "crush" cannot generate a sub-agent adapter (skipping)',
		]);
		expect(db.getSubAgents(projectId)[0].installations[0].provider_ids).toEqual(
			[],
		);
	});

	it("keeps real-checkout and wrap-shadow ownership independent", async () => {
		const shadowPath = mkdtempSync(join(tmpdir(), "capa-subagent-shadow-"));
		try {
			await syncProjectSubagents({
				projectPath,
				projectId,
				capabilities: capabilities(["claude-code"]),
				providers: activeProviders,
				db,
				serverOrigin: "http://127.0.0.1:5912",
			});
			await syncProjectSubagents({
				projectPath: shadowPath,
				projectId,
				capabilities: capabilities([]),
				providers: ["cursor"],
				db,
				serverOrigin: "http://127.0.0.1:5912",
				materializeShadow: true,
			});

			const agent = db.getSubAgents(projectId)[0];
			expect(
				Object.fromEntries(
					agent.installations.map((installation) => [
						installation.install_path,
						installation.provider_ids,
					]),
				),
			).toEqual({
				[canonicalizePath(projectPath)]: ["claude-code"],
				[canonicalizePath(shadowPath)]: ["cursor"],
			});

			await syncProjectSubagents({
				projectPath: shadowPath,
				projectId,
				capabilities: capabilities(["claude-code"]),
				providers: ["cursor"],
				db,
				serverOrigin: "http://127.0.0.1:5912",
				materializeShadow: true,
			});

			expect(
				existsSync(join(projectPath, ".claude", "agents", "reviewer.md")),
			).toBe(true);
			expect(
				existsSync(join(shadowPath, ".cursor", "agents", "reviewer.md")),
			).toBe(false);
			expect(
				db
					.getSubAgents(projectId)[0]
					.installations.find(
						(installation) =>
							installation.install_path === canonicalizePath(projectPath),
					)?.provider_ids,
			).toEqual(["claude-code"]);
		} finally {
			rmSync(shadowPath, { recursive: true, force: true });
		}
	});
});
