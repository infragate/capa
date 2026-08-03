import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { home } from "../paths";

export const cursor: ProviderIntegration = {
	id: "cursor",
	displayName: "Cursor",
	skillsDir: ".cursor/skills",
	globalSkillsDir: join(home, ".cursor/skills"),
	detectInstalled: async () => existsSync(join(home, ".cursor")),
	mcp: {
		configPath: ".cursor/mcp.json",
		format: "json",
		serversKey: "mcpServers",
		serverKey: "capa",
		entryUrlKey: "url",
		supportsSubAgentEntries: false,
		defaultMcpFallbackPath: ".cursor/mcp.json",
	},
	instructions: { filename: "AGENTS.md" },
	rules: {
		dir: ".cursor/rules",
		extension: ".mdc",
		frontmatter: "yaml",
		fieldMap: {
			description: "description",
			appliesTo: "globs",
			alwaysApply: "alwaysApply",
		},
	},
	subagents: {
		dir: ".cursor/agents",
		extension: ".md",
		format: "markdown-frontmatter",
		fields: { model: "inherit", readonly: false, is_background: false },
	},
	pluginManifestPaths: [".cursor-plugin/plugin.json"],
	pluginProviderId: "cursor",
	purgeStaleSubAgentMcp: true,
	hooks: {
		// Cursor reads hooks from a dedicated .cursor/hooks.json with a
		// { version: 1, hooks: { ... } } envelope.
		// Docs: https://cursor.com/docs/agent/hooks
		storage: {
			kind: "standalone",
			configPath: ".cursor/hooks.json",
			format: "json",
			envelope: "cursor-v1",
		},
		shape: "cursor",
		supportsNameTag: true,
		// Cursor common hook stdin: conversation_id (chat) + generation_id (turn).
		// Docs: https://cursor.com/docs/hooks
		activityCorrelation: {
			conversationIdFields: ["conversation_id"],
			generationIdFields: ["generation_id"],
		},
		// Cursor's canonical/provider event surface (see
		// https://cursor.com/docs/agent/hooks). We map every canonical event
		// Cursor has a documented equivalent for; provider-only events (e.g.
		// `afterAgentResponse`, `workspaceOpen`, `beforeTabFileRead`) can be
		// targeted directly via `on: cursor:<eventName>`.
		eventMap: {
			sessionStart: { event: "sessionStart" },
			sessionEnd: { event: "sessionEnd" },
			beforeTool: { event: "preToolUse" },
			afterTool: { event: "postToolUse" },
			afterToolFailure: { event: "postToolUseFailure" },
			beforeShell: { event: "beforeShellExecution" },
			afterShell: { event: "afterShellExecution" },
			beforeMcpCall: { event: "beforeMCPExecution" },
			afterMcpCall: { event: "afterMCPExecution" },
			beforeFileRead: { event: "beforeReadFile" },
			afterFileEdit: { event: "afterFileEdit" },
			userPromptSubmit: { event: "beforeSubmitPrompt" },
			subagentStart: { event: "subagentStart" },
			subagentStop: { event: "subagentStop" },
			preCompact: { event: "preCompact" },
			stop: { event: "stop" },
		},
	},
	wrap: {
		binary: "cursor",
		kind: "gui",
		args: ["--new-window", "--wait"],
		aliases: {
			agent: { binary: "agent", kind: "cli" },
		},
	},
};
