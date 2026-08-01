import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseClaudeManifest } from "../claude-parser";
import { parseCursorManifest } from "../cursor-parser";
import { materializeCommandAsSkill } from "../commands-parser";
import { detectAndParseManifest } from "../detect";
import { resolvePluginRootInString } from "../mcp-parser";

describe("plugin full unpack parsers", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "capa-plugin-full-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function writeClaudePlugin(opts: {
		agents?: boolean;
		hooks?: boolean;
		commands?: boolean;
		skills?: boolean;
		rootSkill?: boolean;
		lsp?: boolean;
	}): void {
		mkdirSync(join(root, ".claude-plugin"), { recursive: true });
		writeFileSync(
			join(root, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
		);
		if (opts.skills !== false && !opts.rootSkill) {
			mkdirSync(join(root, "skills", "hello"), { recursive: true });
			writeFileSync(
				join(root, "skills", "hello", "SKILL.md"),
				"---\nname: hello\ndescription: Hi\n---\n\nHello body\n",
			);
		}
		if (opts.rootSkill) {
			writeFileSync(
				join(root, "SKILL.md"),
				"---\nname: root-skill\ndescription: Root\n---\n\nRoot body\n",
			);
		}
		if (opts.agents) {
			mkdirSync(join(root, "agents"), { recursive: true });
			writeFileSync(
				join(root, "agents", "reviewer.md"),
				"---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\nskills: hello\n---\n\nBe thorough.\n",
			);
		}
		if (opts.hooks) {
			mkdirSync(join(root, "hooks"), { recursive: true });
			writeFileSync(
				join(root, "hooks", "hooks.json"),
				JSON.stringify({
					hooks: {
						PreToolUse: [
							{
								matcher: "Write",
								hooks: [
									{
										type: "command",
										command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/fmt.sh',
									},
								],
							},
						],
					},
				}),
			);
			mkdirSync(join(root, "scripts"), { recursive: true });
			writeFileSync(join(root, "scripts", "fmt.sh"), "#!/bin/sh\necho ok\n");
		}
		if (opts.commands) {
			mkdirSync(join(root, "commands"), { recursive: true });
			writeFileSync(join(root, "commands", "deploy.md"), "# Deploy\n\nDeploy the app.\n");
		}
		if (opts.lsp) {
			writeFileSync(join(root, ".lsp.json"), JSON.stringify({ go: { command: "gopls" } }));
		}
	}

	it("parses agents, hooks, commands and skills from a Claude plugin", () => {
		writeClaudePlugin({ agents: true, hooks: true, commands: true });
		const manifest = parseClaudeManifest(root, {
			name: "demo-plugin",
			version: "1.0.0",
		});
		expect(manifest.skillEntries.map((s) => s.id)).toContain("hello");
		expect(manifest.commandEntries.map((c) => c.id)).toEqual(["deploy"]);
		expect(manifest.agentEntries).toHaveLength(1);
		expect(manifest.agentEntries[0].id).toBe("reviewer");
		expect(manifest.agentEntries[0].description).toBe("Reviews code");
		expect(manifest.agentEntries[0].instructions).toContain("Be thorough");
		expect(manifest.agentEntries[0].skillIds).toEqual(["hello"]);
		expect(manifest.agentEntries[0].droppedFrontmatterKeys).toContain("model");
		expect(manifest.hookEntries).toHaveLength(1);
		expect(manifest.hookEntries[0].event).toBe("PreToolUse");
		expect(manifest.hookEntries[0].matcher).toBe("Write");
		expect(manifest.hookEntries[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
		expect(manifest.hookEntries[0].targetProvider).toBe("claude-code");
	});

	it("parses Cursor manifest hooks path (hooks-cursor.json)", () => {
		mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
		writeFileSync(
			join(root, ".cursor-plugin", "plugin.json"),
			JSON.stringify({
				name: "superpowers",
				hooks: "./hooks/hooks-cursor.json",
			}),
		);
		mkdirSync(join(root, "hooks"), { recursive: true });
		writeFileSync(
			join(root, "hooks", "hooks-cursor.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					sessionStart: [{ command: "./hooks/run-hook.cmd session-start" }],
				},
			}),
		);
		const manifest = parseCursorManifest(root, {
			name: "superpowers",
			hooks: "./hooks/hooks-cursor.json",
		});
		expect(manifest.hookEntries).toHaveLength(1);
		expect(manifest.hookEntries[0].event).toBe("sessionStart");
		expect(manifest.hookEntries[0].targetProvider).toBe("cursor");
		expect(manifest.hookEntries[0].command).toBe(
			"./hooks/run-hook.cmd session-start",
		);
	});

	it("merges Cursor sibling hooks when Claude manifest wins detection", () => {
		mkdirSync(join(root, ".claude-plugin"), { recursive: true });
		writeFileSync(
			join(root, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "superpowers" }),
		);
		mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
		writeFileSync(
			join(root, ".cursor-plugin", "plugin.json"),
			JSON.stringify({
				name: "superpowers",
				hooks: "./hooks/hooks-cursor.json",
			}),
		);
		mkdirSync(join(root, "hooks"), { recursive: true });
		writeFileSync(
			join(root, "hooks", "hooks.json"),
			JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command:
										'"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
								},
							],
						},
					],
				},
			}),
		);
		writeFileSync(
			join(root, "hooks", "hooks-cursor.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					sessionStart: [{ command: "./hooks/run-hook.cmd session-start" }],
				},
			}),
		);
		const manifest = detectAndParseManifest(root, ["claude-code", "cursor"]);
		expect(manifest).not.toBeNull();
		expect(manifest!.provider).toBe("claude");
		const events = manifest!.hookEntries.map((h) => `${h.targetProvider}:${h.event}`);
		expect(events).toContain("claude-code:SessionStart");
		expect(events).toContain("cursor:sessionStart");
	});

	it("discovers root SKILL.md when skills/ is absent", () => {
		writeClaudePlugin({ skills: false, rootSkill: true });
		const manifest = parseClaudeManifest(root, { name: "demo-plugin" });
		expect(manifest.skillEntries).toEqual([
			{ id: "root-skill", relativePath: "." },
		]);
	});

	it("warns about skipped unsupported artifacts", () => {
		writeClaudePlugin({ lsp: true });
		const manifest = parseClaudeManifest(root, { name: "demo-plugin" });
		expect(manifest.skippedArtifacts).toContain("lsp");
	});

	it("parses Cursor rules from rules/", () => {
		mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
		writeFileSync(
			join(root, ".cursor-plugin", "plugin.json"),
			JSON.stringify({ name: "cursor-demo" }),
		);
		mkdirSync(join(root, "rules"), { recursive: true });
		writeFileSync(
			join(root, "rules", "style.mdc"),
			"---\ndescription: Style guide\nglobs: \"**/*.ts\"\nalwaysApply: true\n---\n\nUse consistent style.\n",
		);
		const manifest = parseCursorManifest(root, { name: "cursor-demo" });
		expect(manifest.ruleEntries).toHaveLength(1);
		expect(manifest.ruleEntries[0].id).toBe("style");
		expect(manifest.ruleEntries[0].description).toBe("Style guide");
		expect(manifest.ruleEntries[0].alwaysApply).toBe(true);
		expect(manifest.ruleEntries[0].appliesTo).toEqual(["**/*.ts"]);
		expect(manifest.ruleEntries[0].content).toContain("consistent style");
	});

	it("materializes commands as SKILL.md trees", () => {
		mkdirSync(join(root, "commands"), { recursive: true });
		writeFileSync(join(root, "commands", "ship.md"), "Ship it.\n");
		const dest = join(root, "out", "ship");
		const ok = materializeCommandAsSkill(
			root,
			{ id: "ship", relativePath: "commands/ship.md" },
			dest,
		);
		expect(ok).toBe(true);
		const skillMd = readFileSync(join(dest, "SKILL.md"), "utf-8");
		expect(skillMd).toContain("name: ship");
		expect(skillMd).toContain("Ship it.");
	});

	it("rewrites CLAUDE_PLUGIN_ROOT in hook commands", () => {
		const pluginRoot = "/Users/me/.capa/plugins/proj/demo";
		const resolved = resolvePluginRootInString(
			'"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
			pluginRoot,
			{ shellQuote: true },
		);
		expect(resolved).toBe(
			`"${pluginRoot}/hooks/run-hook.cmd" session-start`,
		);
	});

	it("normalizes Windows backslashes in plugin root for hook commands", () => {
		const resolved = resolvePluginRootInString(
			'"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
			"C:\\Users\\Tony Zaitoun\\.capa\\plugins\\meta\\superpowers",
			{ shellQuote: true },
		);
		expect(resolved).toBe(
			'"C:/Users/Tony Zaitoun/.capa/plugins/meta/superpowers/hooks/run-hook.cmd" session-start',
		);
	});

	it("shell-quotes unquoted CLAUDE_PLUGIN_ROOT paths that contain spaces", () => {
		const resolved = resolvePluginRootInString(
			"${CLAUDE_PLUGIN_ROOT}/hooks/prevent-destructive-commands.py",
			"C:\\Users\\Tony Zaitoun\\.capa\\plugins\\ontology-builder-a6a5\\developer-kit",
			{ shellQuote: true },
		);
		expect(resolved).toBe(
			'"C:/Users/Tony Zaitoun/.capa/plugins/ontology-builder-a6a5/developer-kit/hooks/prevent-destructive-commands.py"',
		);
	});

	it("resolves Cursor relative hook commands with args against the plugin root", () => {
		const resolved = resolvePluginRootInString(
			"./hooks/run-hook.cmd session-start",
			"C:\\Users\\Tony Zaitoun\\.capa\\plugins\\meta\\superpowers",
			{ shellQuote: true },
		);
		expect(resolved).toBe(
			'"C:/Users/Tony Zaitoun/.capa/plugins/meta/superpowers/hooks/run-hook.cmd" session-start',
		);
	});

	it("discover-mode surfaces agents and hooks without a manifest", () => {
		mkdirSync(join(root, "agents"), { recursive: true });
		writeFileSync(
			join(root, "agents", "helper.md"),
			"---\nname: helper\ndescription: Helps\n---\n\nHelp.\n",
		);
		mkdirSync(join(root, "hooks"), { recursive: true });
		writeFileSync(
			join(root, "hooks", "hooks.json"),
			JSON.stringify({
				hooks: {
					Stop: [{ hooks: [{ type: "prompt", prompt: "Summarize" }] }],
				},
			}),
		);
		const manifest = detectAndParseManifest(root, ["claude-code"]);
		expect(manifest).not.toBeNull();
		expect(manifest!.agentEntries.map((a) => a.id)).toContain("helper");
		expect(manifest!.hookEntries.some((h) => h.event === "Stop")).toBe(true);
	});
});
