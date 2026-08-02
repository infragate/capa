import type { UnifiedPluginManifest } from "../../types/plugin";
import { getProvider, getProviderByPluginProviderId } from "../providers";
import { parseAgentEntries } from "./agents-parser";
import { parseCommandEntries } from "./commands-parser";
import { parseHookEntries } from "./hooks-parser";
import { parseMcpServers } from "./mcp-parser";
import { parseRuleEntries } from "./rules-parser";
import { detectSkippedArtifacts } from "./skipped-artifacts";
import {
	isPlainObject,
	parseSkillsField,
	parseSkillsRaw,
} from "./types-helpers";

function buildUnified(
	repoRoot: string,
	record: Record<string, unknown>,
	provider: "claude" | "cursor",
	mcpServers: ReturnType<typeof parseMcpServers>,
): UnifiedPluginManifest {
	const name = typeof record.name === "string" ? record.name : "unknown";
	const skillEntries = parseSkillsField(
		repoRoot,
		parseSkillsRaw(record.skills),
		"skills",
	);
	const knownSkillIds = new Set(skillEntries.map((s) => s.id));
	const commandEntries = parseCommandEntries(repoRoot, record);
	for (const c of commandEntries) knownSkillIds.add(c.id);

	const agentEntries = parseAgentEntries(repoRoot, record, knownSkillIds);
	const hookEntries = parseHookEntries(repoRoot, record).map((h) => ({
		...h,
		targetProvider: "claude-code" as const,
	}));
	// Rules are primarily a Cursor plugin component; still scan for Claude
	// plugins that happen to ship a rules/ directory.
	const ruleEntries = parseRuleEntries(repoRoot, record);
	const skippedArtifacts = detectSkippedArtifacts(repoRoot);

	return {
		name,
		version: typeof record.version === "string" ? record.version : undefined,
		description:
			typeof record.description === "string" ? record.description : undefined,
		provider,
		skillEntries,
		commandEntries,
		agentEntries,
		hookEntries,
		ruleEntries,
		mcpServers,
		skippedArtifacts: skippedArtifacts.length > 0 ? skippedArtifacts : undefined,
	};
}

export function parseClaudeManifest(
	repoRoot: string,
	data: unknown,
	manifestDir: string = ".claude-plugin",
): UnifiedPluginManifest {
	const record = isPlainObject(data) ? data : {};
	const fallback =
		getProvider("claude-code")?.mcp?.defaultMcpFallbackPath ??
		getProviderByPluginProviderId("claude")?.mcp?.defaultMcpFallbackPath;
	const mcpServers = parseMcpServers(repoRoot, data, fallback, manifestDir);
	return buildUnified(repoRoot, record, "claude", mcpServers);
}
