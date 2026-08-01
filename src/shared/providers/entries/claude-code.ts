import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { claudeHome } from "../paths";

export const claudeCode: ProviderIntegration = {
	id: "claude-code",
	displayName: "Claude Code",
	skillsDir: ".claude/skills",
	globalSkillsDir: join(claudeHome, "skills"),
	detectInstalled: async () => existsSync(claudeHome),
	mcp: {
		configPath: ".mcp.json",
		format: "json",
		serversKey: "mcpServers",
		serverKey: "capa",
		entryUrlKey: "url",
		entryType: "http",
		supportsSubAgentEntries: true,
		defaultMcpFallbackPath: ".mcp.json",
	},
	instructions: { filename: "CLAUDE.md" },
	rules: {
		dir: ".claude/rules",
		extension: ".md",
		frontmatter: "yaml",
		fieldMap: { appliesTo: "paths" },
	},
	subagents: {
		dir: ".claude/agents",
		extension: ".md",
		format: "markdown-frontmatter",
		fields: { model: "inherit" },
	},
	pluginManifestPaths: [".claude-plugin/plugin.json"],
	pluginProviderId: "claude",
	wrap: { binary: "claude", kind: "cli" },
	hooks: {
		// Claude Code reads hooks from the project-local .claude/settings.json.
		// Docs: https://docs.claude.com/en/docs/claude-code/hooks
		storage: {
			kind: "inline-config",
			configPath: ".claude/settings.json",
			format: "json",
			hooksKey: "hooks",
		},
		shape: "claude",
		supportsNameTag: true,
		eventMap: {
			sessionStart: { event: "SessionStart" },
			sessionEnd: { event: "SessionEnd" },
			userPromptSubmit: { event: "UserPromptSubmit" },
			beforeTool: { event: "PreToolUse" },
			afterTool: { event: "PostToolUse" },
			beforeShell: { event: "PreToolUse", matcherPrefix: "Bash" },
			afterShell: { event: "PostToolUse", matcherPrefix: "Bash" },
			afterFileEdit: {
				event: "PostToolUse",
				matcherPrefix: "Edit|MultiEdit|Write",
			},
			beforeMcpCall: { event: "PreToolUse", matcherPrefix: "mcp__" },
			afterMcpCall: { event: "PostToolUse", matcherPrefix: "mcp__" },
			subagentStop: { event: "SubagentStop" },
			preCompact: { event: "PreCompact" },
			stop: { event: "Stop" },
		},
	},
};
