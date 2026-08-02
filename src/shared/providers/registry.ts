// Provider registry — the single source of truth for all per-provider facts.
// Each provider's data lives in entries/*; this module assembles them.

import type { ProviderIntegration } from "../../types/providers";
import { claudeCode } from "./entries/claude-code";
import { codex } from "./entries/codex";
import { cursor } from "./entries/cursor";
import { geminiCli } from "./entries/gemini-cli";
import { githubCopilot } from "./entries/github-copilot";
import { opencode } from "./entries/opencode";
import { partialIntegrationProviders } from "./entries/partial-integration";
import { skillsOnlyProviders } from "./entries/skills-only";

/**
 * All known providers. Cursor, Claude Code, and Codex include full
 * MCP/instructions/rules/subagents/plugin integration data inline.
 * All other entries are skill-path only for now.
 */
export const providers: Record<string, ProviderIntegration> = {
	"claude-code": claudeCode,
	codex,
	cursor,
	"gemini-cli": geminiCli,
	"github-copilot": githubCopilot,
	opencode,
	...partialIntegrationProviders,
	...skillsOnlyProviders,
};
