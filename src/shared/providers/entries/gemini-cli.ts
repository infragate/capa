import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { home } from "../paths";

export const geminiCli: ProviderIntegration = {
	id: "gemini-cli",
	displayName: "Gemini CLI",
	skillsDir: ".agents/skills",
	globalSkillsDir: join(home, ".gemini/skills"),
	detectInstalled: async () => existsSync(join(home, ".gemini")),
	mcp: {
		// Gemini settings is a regular JSON object with a top-level `mcpServers`.
		// We register the capa endpoint as `httpUrl` (streamable HTTP), not
		// `url` (SSE).
		configPath: ".gemini/settings.json",
		format: "json",
		serversKey: "mcpServers",
		serverKey: "capa",
		entryUrlKey: "httpUrl",
		supportsSubAgentEntries: true,
	},
	instructions: { filename: "AGENTS.md" },
	subagents: {
		dir: ".gemini/agents",
		extension: ".md",
		format: "markdown-frontmatter",
	},
	hooks: {
		// Gemini CLI hooks live alongside its other settings in
		// .gemini/settings.json under a top-level `hooks` key. The shape
		// (matcher group + nested `hooks` array) mirrors Claude's, but the
		// event names and matcher conventions are Gemini-specific:
		//   - tool events are BeforeTool/AfterTool (not Pre/PostToolUse).
		//   - matcher is a regex over the tool name, where built-in tools
		//     are snake_case (run_shell_command, read_file, write_file, …)
		//     and MCP tools follow `mcp_<server>_<tool>`.
		// Events without a Gemini equivalent (`stop`) are simply omitted —
		// hooks targeting them are skipped with a one-shot warning.
		// Docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
		storage: {
			kind: "inline-config",
			configPath: ".gemini/settings.json",
			format: "json",
			hooksKey: "hooks",
		},
		shape: "gemini",
		supportsNameTag: true,
		eventMap: {
			sessionStart: { event: "SessionStart" },
			sessionEnd: { event: "SessionEnd" },
			userPromptSubmit: { event: "BeforeAgent" },
			beforeTool: { event: "BeforeTool" },
			afterTool: { event: "AfterTool" },
			beforeShell: {
				event: "BeforeTool",
				matcherPrefix: "run_shell_command",
			},
			afterShell: { event: "AfterTool", matcherPrefix: "run_shell_command" },
			beforeFileRead: { event: "BeforeTool", matcherPrefix: "read_file" },
			afterFileEdit: {
				event: "AfterTool",
				matcherPrefix: "write_file|replace|edit_file",
			},
			beforeMcpCall: { event: "BeforeTool", matcherPrefix: "mcp_.*" },
			afterMcpCall: { event: "AfterTool", matcherPrefix: "mcp_.*" },
			preCompact: { event: "PreCompress" },
		},
	},
};
