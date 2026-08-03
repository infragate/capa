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
		activityAttributes: {
			attributes: [
				{ key: "model", fields: ["model"] },
				{ key: "model_id", fields: ["model_id"] },
				{ key: "model_params", fields: ["model_params"], kind: "json" },
				{ key: "provider_version", fields: ["cursor_version"] },
				{ key: "user_email", fields: ["user_email"] },
				{ key: "transcript_path", fields: ["transcript_path"] },
				{ key: "workspace_roots", fields: ["workspace_roots"], kind: "json" },
				{ key: "cwd", fields: ["cwd"] },
				{ key: "hook_event_name", fields: ["hook_event_name"] },
				{ key: "tool_use_id", fields: ["tool_use_id"] },
				{ key: "duration_ms", fields: ["duration", "duration_ms"], kind: "number" },
				{ key: "composer_mode", fields: ["composer_mode"] },
				{ key: "is_background_agent", fields: ["is_background_agent"], kind: "boolean" },
				{ key: "session_reason", fields: ["reason"] },
				{ key: "final_status", fields: ["final_status", "status"] },
				{ key: "sandbox", fields: ["sandbox"], kind: "boolean" },
				{ key: "failure_type", fields: ["failure_type"] },
				{ key: "is_interrupt", fields: ["is_interrupt"], kind: "boolean" },
				{ key: "subagent_type", fields: ["subagent_type"] },
				{ key: "subagent_model", fields: ["subagent_model"] },
				{ key: "subagent_id", fields: ["subagent_id"] },
				{ key: "parent_conversation_id", fields: ["parent_conversation_id"] },
				{ key: "git_branch", fields: ["git_branch"] },
				{ key: "loop_count", fields: ["loop_count"], kind: "number" },
			],
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
