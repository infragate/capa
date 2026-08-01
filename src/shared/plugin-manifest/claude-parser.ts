import type { UnifiedPluginManifest } from "../../types/plugin";
import { getProvider, getProviderByPluginProviderId } from "../providers";
import { parseMcpServers } from "./mcp-parser";
import {
	isPlainObject,
	parseSkillsField,
	parseSkillsRaw,
} from "./types-helpers";

export function parseClaudeManifest(
	repoRoot: string,
	data: unknown,
	manifestDir: string = ".claude-plugin",
): UnifiedPluginManifest {
	const record = isPlainObject(data) ? data : {};
	const name = typeof record.name === "string" ? record.name : "unknown";
	const skills = parseSkillsField(
		repoRoot,
		parseSkillsRaw(record.skills),
		"skills",
	);
	const fallback =
		getProvider("claude-code")?.mcp?.defaultMcpFallbackPath ??
		getProviderByPluginProviderId("claude")?.mcp?.defaultMcpFallbackPath;
	const mcpServers = parseMcpServers(repoRoot, data, fallback, manifestDir);

	return {
		name,
		version: typeof record.version === "string" ? record.version : undefined,
		description:
			typeof record.description === "string" ? record.description : undefined,
		provider: "claude",
		skillEntries: skills,
		mcpServers,
	};
}
