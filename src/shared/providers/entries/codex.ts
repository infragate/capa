import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { codexHome } from "../paths";

export const codex: ProviderIntegration = {
	id: "codex",
	displayName: "Codex",
	skillsDir: ".agents/skills",
	globalSkillsDir: join(codexHome, "skills"),
	detectInstalled: async () =>
		existsSync(codexHome) || existsSync("/etc/codex"),
	mcp: {
		configPath: ".codex/config.toml",
		format: "toml",
		serversKey: "mcp_servers",
		serverKey: "capa",
		entryUrlKey: "url",
		supportsSubAgentEntries: true,
	},
	instructions: { filename: "AGENTS.md" },
	subagents: {
		dir: ".codex/agents",
		extension: ".toml",
		format: "toml",
		bodyField: "developer_instructions",
	},
	hooks: {
		// Codex reads hooks from .codex/config.toml as a [hooks] table whose
		// shape is *structurally identical* to Claude's `.claude/settings.json`
		// hook map: a top-level event key holds an array of matcher groups
		// (`{ matcher, hooks: [...] }`), and each handler in the inner `hooks`
		// array is a `{ type, command, ... }` table. Capa therefore reuses the
		// `claude` shape handler — the only difference is TOML vs JSON
		// serialisation (handled by `storage.format`).
		//
		// Codex's TOML form (per `codex-rs/config/src/hook_config.rs`) is:
		//   [[hooks.PreToolUse]]
		//   matcher = "Bash"
		//   [[hooks.PreToolUse.hooks]]
		//   type = "command"
		//   command = "..."
		//
		// Identification: `MatcherGroup` and `HookHandlerConfig` do NOT use
		// `#[serde(deny_unknown_fields)]`, so capa appends an opaque
		// `name = "capa:<id>"` field on entries it owns. Codex ignores it but
		// round-trips it through writes; capa uses it for surgical updates.
		//
		// Built-in matcher tool names are `Bash`, `apply_patch`, and
		// `mcp__server__tool` for MCP. Events without a matcher
		// (UserPromptSubmit, Stop, …) accept an empty/omitted matcher.
		// Docs: https://developers.openai.com/codex/hooks
		storage: {
			kind: "inline-config",
			configPath: ".codex/config.toml",
			format: "toml",
			hooksKey: "hooks",
		},
		shape: "claude",
		supportsNameTag: true,
		// Codex hook payloads mirror Claude's common fields (session_id).
		activityCorrelation: {
			conversationIdFields: ["session_id"],
			generationIdFields: ["prompt_id"],
		},
		eventMap: {
			sessionStart: { event: "SessionStart" },
			userPromptSubmit: { event: "UserPromptSubmit" },
			beforeTool: { event: "PreToolUse" },
			afterTool: { event: "PostToolUse" },
			beforeShell: { event: "PreToolUse", matcherPrefix: "Bash" },
			afterShell: { event: "PostToolUse", matcherPrefix: "Bash" },
			afterFileEdit: { event: "PostToolUse", matcherPrefix: "apply_patch" },
			beforeMcpCall: { event: "PreToolUse", matcherPrefix: "mcp__" },
			afterMcpCall: { event: "PostToolUse", matcherPrefix: "mcp__" },
			subagentStart: { event: "SubagentStart" },
			subagentStop: { event: "SubagentStop" },
			preCompact: { event: "PreCompact" },
			stop: { event: "Stop" },
		},
	},
	wrap: { binary: "codex", kind: "cli" },
};
