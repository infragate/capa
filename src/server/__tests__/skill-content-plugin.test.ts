import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Capabilities, Skill } from "../../types/capabilities";
import {
	resolveSkillContent,
	resolveSkillContentById,
	resolveSkillDescription,
} from "../skill-content";

describe("resolveSkillContent plugin unpack", () => {
	let dir: string;
	let projectPath: string;
	let pluginsBase: string;
	const projectId = "proj-test";
	const pluginId = "fixture-plugin";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-skill-content-"));
		projectPath = join(dir, "project");
		pluginsBase = join(dir, "plugins", projectId);
		mkdirSync(projectPath, { recursive: true });

		const skillDir = join(pluginsBase, pluginId, "skills", "hello-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: hello-skill\ndescription: From plugin unpack\n---\n\nPlugin body.\n",
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const pluginSkill: Skill = {
		id: "hello-skill",
		type: "plugin",
		def: {},
		sourcePlugin: {
			id: pluginId,
			name: "Fixture Plugin",
			provider: "claude",
		},
	};

	it("loads plugin skill content from the unpacked plugin tree without install", () => {
		const result = resolveSkillContent(projectPath, pluginSkill, ["claude-code"], {
			projectId,
			pluginsBaseDir: pluginsBase,
		});

		expect(result).not.toBeNull();
		expect(result!.content).toContain("Plugin body.");
		expect(result!.metadata.description).toBe("From plugin unpack");
	});

	it("resolveSkillContentById finds plugin skills via unpack dir", async () => {
		const caps: Capabilities = {
			providers: ["claude-code"],
			skills: [pluginSkill],
			tools: [],
			servers: [],
			plugins: [
				{
					id: pluginId,
					type: "github",
					def: { repo: "owner/fixture-plugin" },
				},
			],
		};

		const result = await resolveSkillContentById(
			projectPath,
			caps,
			"hello-skill",
			undefined,
			{ projectId, pluginsBaseDir: pluginsBase },
		);

		expect(result).not.toBeNull();
		expect(result!.content).toContain("Plugin body.");
	});

	it("resolveSkillDescription reads frontmatter from unpack dir", () => {
		const { description, descriptionSource } = resolveSkillDescription(
			projectPath,
			pluginSkill,
			["claude-code"],
			{ projectId, pluginsBaseDir: pluginsBase },
		);

		expect(description).toBe("From plugin unpack");
		expect(descriptionSource).toBe("frontmatter");
	});

	it("loads command-materialized skills under .capa-commands", () => {
		const cmdDir = join(pluginsBase, pluginId, ".capa-commands", "slash-cmd");
		mkdirSync(cmdDir, { recursive: true });
		writeFileSync(
			join(cmdDir, "SKILL.md"),
			"---\nname: slash-cmd\ndescription: Command skill\n---\n\nCmd body.\n",
		);

		const skill: Skill = {
			id: "slash-cmd",
			type: "plugin",
			def: {},
			sourcePlugin: {
				id: pluginId,
				name: "Fixture Plugin",
				provider: "claude",
			},
		};

		const result = resolveSkillContent(projectPath, skill, ["claude-code"], {
			projectId,
			pluginsBaseDir: pluginsBase,
		});

		expect(result).not.toBeNull();
		expect(result!.content).toContain("Cmd body.");
	});
});