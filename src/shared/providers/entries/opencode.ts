import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { claudeHome, configHome } from "../paths";

export const opencode: ProviderIntegration = {
	id: "opencode",
	displayName: "OpenCode",
	skillsDir: ".agents/skills",
	globalSkillsDir: join(configHome, "opencode/skills"),
	detectInstalled: async () =>
		existsSync(join(configHome, "opencode")) ||
		existsSync(join(claudeHome, "skills")),
	mcp: {
		configPath: "opencode.json",
		format: "json",
		serversKey: "mcp",
		serverKey: "capa",
		entryUrlKey: "url",
		entryType: "remote",
		entryExtraFields: { enabled: true },
		supportsSubAgentEntries: true,
		// OpenCode auto-exposes every entry under top-level `mcp` to all
		// primary agents (Build, Plan, …). Without this fence each
		// `capa-<id>` MCP — meant for one sub-agent — pollutes the main
		// session with sub-agent-only tool blocks. Pattern intentionally
		// does NOT match the bare main `capa_*` tools.
		// Docs: https://opencode.ai/docs/mcp-servers/#per-agent
		subAgentScopeFence: {
			key: "permission",
			pattern: "capa-*_*",
			value: "deny",
		},
	},
	instructions: { filename: "AGENTS.md" },
	subagents: {
		dir: ".opencode/agents",
		extension: ".md",
		format: "markdown-frontmatter",
		fields: { mode: "subagent" },
		// Re-allow the sub-agent's own MCP tools after the global fence.
		perAgentToolScope: {
			key: "permission",
			patternTemplate: "capa-{id}_*",
			value: "allow",
		},
	},
	wrap: { binary: "opencode", kind: "cli" },
};
