// Providers with partial integration (MCP, rules, subagents, or instructions
// beyond the basic skill-path fields) that don't warrant a dedicated file.

import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { configHome, home } from "../paths";

export const partialIntegrationProviders: Record<string, ProviderIntegration> =
	{
		antigravity: {
			id: "antigravity",
			displayName: "Antigravity",
			skillsDir: ".agent/skills",
			globalSkillsDir: join(home, ".gemini/antigravity/skills"),
			detectInstalled: async () =>
				existsSync(join(process.cwd(), ".agent")) ||
				existsSync(join(home, ".gemini/antigravity")),
			// Antigravity IDE has no project-local MCP file; the CLI uses
			// `.agents/mcp_config.json` with `serverUrl` (not `url`). Holding off
			// until we either split into antigravity-cli or extend McpIntegration.
			instructions: { filename: "AGENTS.md" },
			rules: {
				dir: ".agents/rules",
				extension: ".md",
				frontmatter: "none",
			},
		},
		augment: {
			id: "augment",
			displayName: "Augment",
			skillsDir: ".augment/skills",
			globalSkillsDir: join(home, ".augment/skills"),
			detectInstalled: async () => existsSync(join(home, ".augment")),
			// MCP is global-only (~/.augment/settings.json); no project-local file.
			instructions: { filename: "AGENTS.md" },
			subagents: {
				dir: ".augment/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		codebuddy: {
			id: "codebuddy",
			displayName: "CodeBuddy",
			skillsDir: ".codebuddy/skills",
			globalSkillsDir: join(home, ".codebuddy/skills"),
			detectInstalled: async () =>
				existsSync(join(process.cwd(), ".codebuddy")) ||
				existsSync(join(home, ".codebuddy")),
			// `.mcp.json` is documented for the CodeBuddy CLI only, not the IDE.
			mcp: {
				configPath: ".mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "http",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "CODEBUDDY.md" },
			// Skipping rules — CodeBuddy uses `.codebuddy/rules/<name>/RULE.mdc`
			// (directory-per-rule), which doesn't match capa's flat file model.
		},
		crush: {
			id: "crush",
			displayName: "Crush",
			skillsDir: ".crush/skills",
			globalSkillsDir: join(home, ".config/crush/skills"),
			detectInstalled: async () => existsSync(join(home, ".config/crush")),
			mcp: {
				// Crush uses `mcp` (not `mcpServers`) at the top of `.crush.json`.
				configPath: ".crush.json",
				format: "json",
				serversKey: "mcp",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "http",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
		},
		droid: {
			id: "droid",
			displayName: "Droid",
			skillsDir: ".factory/skills",
			globalSkillsDir: join(home, ".factory/skills"),
			detectInstalled: async () => existsSync(join(home, ".factory")),
			mcp: {
				configPath: ".factory/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "http",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			subagents: {
				dir: ".factory/droids",
				extension: ".md",
				format: "markdown-frontmatter",
				fields: { model: "inherit" },
			},
			// Droid documents `.factory-plugin/plugin.json` plugin manifests, but
			// capa has no parser for that schema. See the note on `augment`.
		},
		"iflow-cli": {
			id: "iflow-cli",
			displayName: "iFlow CLI",
			skillsDir: ".iflow/skills",
			globalSkillsDir: join(home, ".iflow/skills"),
			detectInstalled: async () => existsSync(join(home, ".iflow")),
			mcp: {
				configPath: ".iflow/settings.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "httpUrl",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
		},
		junie: {
			id: "junie",
			displayName: "Junie",
			skillsDir: ".junie/skills",
			globalSkillsDir: join(home, ".junie/skills"),
			detectInstalled: async () => existsSync(join(home, ".junie")),
			// Junie's native remote-HTTP schema is undocumented; this bare { url } entry is unverified.
			mcp: {
				configPath: ".junie/mcp/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			subagents: {
				dir: ".junie/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		kilo: {
			id: "kilo",
			displayName: "Kilo Code",
			skillsDir: ".kilocode/skills",
			globalSkillsDir: join(home, ".kilocode/skills"),
			detectInstalled: async () => existsSync(join(home, ".kilocode")),
			// Kilo is mid-rename `.kilocode/` → `.kilo/`. The legacy MCP path is
			// still loaded by current Kilo releases.
			mcp: {
				configPath: ".kilocode/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "streamable-http",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			rules: {
				dir: ".kilo/rules",
				extension: ".md",
				frontmatter: "none",
			},
			subagents: {
				dir: ".kilo/agent",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		"kiro-cli": {
			id: "kiro-cli",
			displayName: "Kiro CLI",
			skillsDir: ".kiro/skills",
			globalSkillsDir: join(home, ".kiro/skills"),
			detectInstalled: async () => existsSync(join(home, ".kiro")),
			mcp: {
				configPath: ".kiro/settings/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			rules: {
				// Kiro calls these "steering" files. The inclusion-mode frontmatter
				// field name (`inclusion`?) is not 100% confirmed from public docs;
				// we emit the rules without frontmatter and let users add per-file
				// inclusion manually until verified.
				dir: ".kiro/steering",
				extension: ".md",
				frontmatter: "none",
			},
		},
		kode: {
			id: "kode",
			displayName: "Kode",
			skillsDir: ".kode/skills",
			globalSkillsDir: join(home, ".kode/skills"),
			detectInstalled: async () => existsSync(join(home, ".kode")),
			mcp: {
				configPath: ".mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "http",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			subagents: {
				dir: ".kode/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
			// Kode plugins live at `.kode-plugin/plugin.json` (with a legacy
			// `.claude-plugin/` fallback in some repos). The new schema isn't
			// covered by capa's Claude or Cursor parsers, so we don't declare Kode
			// as a plugin source yet. Plugins shipping the legacy
			// `.claude-plugin/plugin.json` are already discoverable via the
			// claude-code entry.
		},
		neovate: {
			id: "neovate",
			displayName: "Neovate",
			skillsDir: ".neovate/skills",
			globalSkillsDir: join(home, ".neovate/skills"),
			detectInstalled: async () => existsSync(join(home, ".neovate")),
			mcp: {
				configPath: ".neovate/config.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "http",
				supportsSubAgentEntries: true,
			},
			// No project-root instructions file documented for Neovate.
			// Sub-agents are registered through TypeScript plugin code, not files.
		},
		pochi: {
			id: "pochi",
			displayName: "Pochi",
			skillsDir: ".pochi/skills",
			globalSkillsDir: join(home, ".pochi/skills"),
			detectInstalled: async () => existsSync(join(home, ".pochi")),
			mcp: {
				// `.pochi/config.jsonc` is JSONC; capa writes vanilla JSON which
				// JSONC parses fine. Top-level key is `mcp`, not `mcpServers`.
				configPath: ".pochi/config.jsonc",
				format: "json",
				serversKey: "mcp",
				serverKey: "capa",
				entryUrlKey: "url",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "README.pochi.md" },
			subagents: {
				dir: ".pochi/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		qoder: {
			id: "qoder",
			displayName: "Qoder",
			skillsDir: ".qoder/skills",
			globalSkillsDir: join(home, ".qoder/skills"),
			detectInstalled: async () => existsSync(join(home, ".qoder")),
			// MCP servers are managed via the IDE UI; no project-local file.
			instructions: { filename: "AGENTS.md" },
			rules: {
				// Per-rule behavior (always/specific-files/model-decision/manual) is
				// selected via the Qoder IDE, not YAML frontmatter, so we emit plain
				// markdown rule files.
				dir: ".qoder/rules",
				extension: ".md",
				frontmatter: "none",
			},
			subagents: {
				dir: ".qoder/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		"qwen-code": {
			id: "qwen-code",
			displayName: "Qwen Code",
			skillsDir: ".qwen/skills",
			globalSkillsDir: join(home, ".qwen/skills"),
			detectInstalled: async () => existsSync(join(home, ".qwen")),
			mcp: {
				configPath: ".qwen/settings.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "httpUrl",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			subagents: {
				dir: ".qwen/agents",
				extension: ".md",
				format: "markdown-frontmatter",
			},
		},
		roo: {
			id: "roo",
			displayName: "Roo Code",
			skillsDir: ".roo/skills",
			globalSkillsDir: join(home, ".roo/skills"),
			detectInstalled: async () => existsSync(join(home, ".roo")),
			mcp: {
				configPath: ".roo/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				entryType: "streamable-http",
				supportsSubAgentEntries: true,
			},
		},
		trae: {
			id: "trae",
			displayName: "Trae",
			skillsDir: ".trae/skills",
			globalSkillsDir: join(home, ".trae/skills"),
			detectInstalled: async () => existsSync(join(home, ".trae")),
			// Trae reads `.trae/mcp.json` only when the user toggles
			// Settings → Agents → Read project MCP config.
			mcp: {
				configPath: ".trae/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			rules: {
				dir: ".trae/rules",
				extension: ".md",
				frontmatter: "none",
			},
		},
		"trae-cn": {
			id: "trae-cn",
			displayName: "Trae CN",
			skillsDir: ".trae/skills",
			globalSkillsDir: join(home, ".trae-cn/skills"),
			detectInstalled: async () => existsSync(join(home, ".trae-cn")),
			mcp: {
				configPath: ".trae/mcp.json",
				format: "json",
				serversKey: "mcpServers",
				serverKey: "capa",
				entryUrlKey: "url",
				supportsSubAgentEntries: true,
			},
			instructions: { filename: "AGENTS.md" },
			rules: {
				dir: ".trae/rules",
				extension: ".md",
				frontmatter: "none",
			},
		},
		windsurf: {
			id: "windsurf",
			displayName: "Windsurf",
			skillsDir: ".windsurf/skills",
			globalSkillsDir: join(home, ".codeium/windsurf/skills"),
			detectInstalled: async () => existsSync(join(home, ".codeium/windsurf")),
			rules: {
				dir: ".windsurf/rules",
				extension: ".md",
				frontmatter: "yaml",
				fieldMap: {
					description: "description",
					appliesTo: "globs",
					alwaysApply: "trigger",
					alwaysApplyValues: {
						trueValue: "always_on",
						falseValue: "model_decision",
					},
				},
			},
		},
	};
