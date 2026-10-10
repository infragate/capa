import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { home } from "../paths";

export const antigravity: ProviderIntegration = {
	id: "antigravity",
	displayName: "Antigravity",
	skillsDir: ".agents/skills",
	globalSkillsDir: join(home, ".gemini/config/skills"),
	// Not `.agents/`: capa writes that tree for every universal-skills provider,
	// so it would flag Antigravity in most capa projects.
	detectInstalled: async () =>
		existsSync(join(process.cwd(), ".agent")) ||
		existsSync(join(home, ".gemini/antigravity")),
	mcp: {
		// Remote entries use `serverUrl`; the docs say `url` and `httpUrl` are
		// not supported. No `type` discriminator is documented.
		// Docs: https://antigravity.google/docs/mcp/
		configPath: ".agents/mcp_config.json",
		format: "json",
		serversKey: "mcpServers",
		serverKey: "capa",
		entryUrlKey: "serverUrl",
		supportsSubAgentEntries: true,
	},
	instructions: { filename: "AGENTS.md" },
	rules: {
		dir: ".agents/rules",
		extension: ".md",
		frontmatter: "none",
	},
	hooks: {
		// `.agents/hooks.json` maps hook NAMES to event configs, so each capa
		// hook becomes its own top-level `capa:<id>` key (see the
		// `antigravity` shape in hook-handlers.ts).
		// Docs: https://antigravity.google/docs/hooks/
		storage: {
			kind: "standalone",
			configPath: ".agents/hooks.json",
			format: "json",
		},
		shape: "antigravity",
		supportsNameTag: true,
		// Common stdin: conversationId, workspacePaths, transcriptPath,
		// artifactDirectoryPath, modelName. No per-turn id is documented.
		activityCorrelation: {
			conversationIdFields: ["conversationId"],
			generationIdFields: [],
		},
		activityAttributes: {
			attributes: [
				{ key: "model", fields: ["modelName"] },
				{ key: "transcript_path", fields: ["transcriptPath"] },
				{ key: "workspace_roots", fields: ["workspacePaths"], kind: "json" },
			],
		},
		// No activityResultFields: PostToolUse documents only `error`, no output.
		// Matchers are regexes over Antigravity's built-in tool names. MCP
		// tool naming isn't documented, so before/afterMcpCall stay unmapped.
		// PreInvocation / PostInvocation have no canonical equivalent; target
		// them with `on: antigravity:PreInvocation`.
		eventMap: {
			beforeTool: { event: "PreToolUse" },
			afterTool: { event: "PostToolUse" },
			beforeShell: { event: "PreToolUse", matcherPrefix: "run_command" },
			afterShell: { event: "PostToolUse", matcherPrefix: "run_command" },
			beforeFileRead: { event: "PreToolUse", matcherPrefix: "view_file" },
			afterFileEdit: {
				event: "PostToolUse",
				matcherPrefix:
					"write_to_file|replace_file_content|multi_replace_file_content",
			},
			stop: { event: "Stop" },
		},
	},
};
