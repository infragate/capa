import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { home } from "../paths";

export const githubCopilot: ProviderIntegration = {
	id: "github-copilot",
	displayName: "GitHub Copilot",
	skillsDir: ".agents/skills",
	globalSkillsDir: join(home, ".copilot/skills"),
	detectInstalled: async () =>
		existsSync(join(process.cwd(), ".github")) ||
		existsSync(join(home, ".copilot")),
	mcp: {
		configPath: ".vscode/mcp.json",
		format: "json",
		serversKey: "servers",
		serverKey: "capa",
		entryUrlKey: "url",
		entryType: "http",
		supportsSubAgentEntries: false,
	},
	instructions: { filename: ".github/copilot-instructions.md" },
	rules: {
		dir: ".github/instructions",
		extension: ".instructions.md",
		frontmatter: "yaml",
		fieldMap: { appliesTo: "applyTo" },
	},
	subagents: {
		dir: ".github/agents",
		extension: ".md",
		format: "markdown-frontmatter",
	},
	// No wrap: owned paths live under shared project dirs (`.github`, `.vscode`).
	// Wrap's exclusion model is top-level only, so enabling wrap would omit those
	// entire trees from the shadow workspace. Revisit when wrap supports
	// subpath-level exclusions/overlays.
};
