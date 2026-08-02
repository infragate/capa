// Providers whose integration is limited to skill paths (and optionally a
// lightweight instructions file). No MCP, rules, subagents, or hooks.

import { existsSync } from "fs";
import { join } from "path";
import type { ProviderIntegration } from "../../../types/providers";
import { configHome, home } from "../paths";

export const skillsOnlyProviders: Record<string, ProviderIntegration> = {
	amp: {
		id: "amp",
		displayName: "Amp",
		skillsDir: ".agents/skills",
		globalSkillsDir: join(configHome, "agents/skills"),
		detectInstalled: async () => existsSync(join(configHome, "amp")),
	},
	openclaw: {
		id: "openclaw",
		displayName: "OpenClaw",
		skillsDir: "skills",
		globalSkillsDir: existsSync(join(home, ".openclaw"))
			? join(home, ".openclaw/skills")
			: existsSync(join(home, ".clawdbot"))
				? join(home, ".clawdbot/skills")
				: join(home, ".moltbot/skills"),
		detectInstalled: async () =>
			existsSync(join(home, ".openclaw")) ||
			existsSync(join(home, ".clawdbot")) ||
			existsSync(join(home, ".moltbot")),
	},
	cline: {
		id: "cline",
		displayName: "Cline",
		skillsDir: ".cline/skills",
		globalSkillsDir: join(home, ".cline/skills"),
		detectInstalled: async () => existsSync(join(home, ".cline")),
		// MCP is global-only (~/.cline/mcp.json); no project-local file.
		instructions: { filename: "AGENTS.md" },
	},
	"command-code": {
		id: "command-code",
		displayName: "Command Code",
		skillsDir: ".commandcode/skills",
		globalSkillsDir: join(home, ".commandcode/skills"),
		detectInstalled: async () => existsSync(join(home, ".commandcode")),
	},
	continue: {
		id: "continue",
		displayName: "Continue",
		skillsDir: ".continue/skills",
		globalSkillsDir: join(home, ".continue/skills"),
		detectInstalled: async () =>
			existsSync(join(process.cwd(), ".continue")) ||
			existsSync(join(home, ".continue")),
	},
	goose: {
		id: "goose",
		displayName: "Goose",
		skillsDir: ".goose/skills",
		globalSkillsDir: join(configHome, "goose/skills"),
		detectInstalled: async () => existsSync(join(configHome, "goose")),
		// MCP is global-only (~/.config/goose/config.yaml); no project-local file.
		instructions: { filename: "AGENTS.md" },
	},
	"kimi-cli": {
		id: "kimi-cli",
		displayName: "Kimi Code CLI",
		skillsDir: ".agents/skills",
		globalSkillsDir: join(home, ".config/agents/skills"),
		detectInstalled: async () => existsSync(join(home, ".kimi")),
		// MCP is global-only (~/.kimi/mcp.json); no project-local file.
		instructions: { filename: "AGENTS.md" },
		wrap: { binary: "kimi", kind: "cli" },
	},
	mcpjam: {
		id: "mcpjam",
		displayName: "MCPJam",
		skillsDir: ".mcpjam/skills",
		globalSkillsDir: join(home, ".mcpjam/skills"),
		detectInstalled: async () => existsSync(join(home, ".mcpjam")),
	},
	"mistral-vibe": {
		id: "mistral-vibe",
		displayName: "Mistral Vibe",
		skillsDir: ".vibe/skills",
		globalSkillsDir: join(home, ".vibe/skills"),
		detectInstalled: async () => existsSync(join(home, ".vibe")),
		// MCP lives in `.vibe/config.toml` as TOML array-of-tables
		// (`[[mcp_servers]]`), which doesn't fit the current
		// `serversKey: <map>` model — held until McpIntegration supports it.
		instructions: { filename: "AGENTS.md" },
	},
	mux: {
		id: "mux",
		displayName: "Mux",
		skillsDir: ".mux/skills",
		globalSkillsDir: join(home, ".mux/skills"),
		detectInstalled: async () => existsSync(join(home, ".mux")),
	},
	openhands: {
		id: "openhands",
		displayName: "OpenHands",
		skillsDir: ".openhands/skills",
		globalSkillsDir: join(home, ".openhands/skills"),
		detectInstalled: async () => existsSync(join(home, ".openhands")),
		// MCP is global-only (~/.openhands/mcp.json); no project-local file.
		instructions: { filename: "AGENTS.md" },
	},
	pi: {
		id: "pi",
		displayName: "Pi",
		skillsDir: ".pi/skills",
		globalSkillsDir: join(home, ".pi/agent/skills"),
		detectInstalled: async () => existsSync(join(home, ".pi/agent")),
		// Core Pi has no project-local MCP; community extensions add one.
		instructions: { filename: "AGENTS.md" },
	},
	replit: {
		id: "replit",
		displayName: "Replit",
		skillsDir: ".agents/skills",
		globalSkillsDir: join(configHome, "agents/skills"),
		showInUniversalList: false,
		detectInstalled: async () => existsSync(join(process.cwd(), ".agents")),
		// Replit Agent reads `replit.md` only (not AGENTS.md). MCP is added
		// through the Integrations page (per-account, not per-project).
		instructions: { filename: "replit.md" },
	},
	zencoder: {
		id: "zencoder",
		displayName: "Zencoder",
		skillsDir: ".zencoder/skills",
		globalSkillsDir: join(home, ".zencoder/skills"),
		detectInstalled: async () => existsSync(join(home, ".zencoder")),
	},
	adal: {
		id: "adal",
		displayName: "AdaL",
		skillsDir: ".adal/skills",
		globalSkillsDir: join(home, ".adal/skills"),
		detectInstalled: async () => existsSync(join(home, ".adal")),
		// MCP is CLI-managed (`/mcp add` at runtime); no project-local file.
		instructions: { filename: "AGENTS.md" },
	},
};
