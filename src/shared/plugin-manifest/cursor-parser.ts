import type { UnifiedPluginManifest } from "../../types/plugin";
import { getProvider } from "../providers";
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

/**
 * Cursor's CLI registers `http://localhost:8787/callback` as its OAuth2 loopback
 * redirect URI. When capa picks a plugin's cursor manifest (because a claude
 * variant either doesn't exist or isn't a preferred provider) the .cursor-mcp.json
 * embeds the OAuth `client_id` of Cursor's registered app but omits the callback
 * port — Cursor itself uses the `cursor://anysphere.cursor-mcp/oauth/callback`
 * custom scheme which capa, being a CLI, cannot receive. Defaulting to the
 * Cursor CLI's loopback lets capa impersonate the CLI for the same client_id.
 */
export const CURSOR_CLI_CALLBACK_PORT = 8787;

/**
 * For each MCP server with embedded oauth2 + client_id but no callback_port,
 * inject the Cursor CLI's loopback port. Done in-place on the parsed map.
 */
function applyCursorCliLoopback(
	mcpServers: ReturnType<typeof parseMcpServers>,
): void {
	for (const def of Object.values(mcpServers)) {
		if (!def.oauth2 || typeof def.oauth2 !== "object") continue;
		const o = def.oauth2 as Record<string, unknown>;
		const hasClientId =
			typeof o.client_id === "string" ||
			typeof o.clientId === "string" ||
			typeof o.CLIENT_ID === "string";
		const hasCallbackPort =
			(typeof o.callback_port === "number" && o.callback_port > 0) ||
			(typeof o.callbackPort === "number" && (o.callbackPort as number) > 0) ||
			(typeof o.CALLBACK_PORT === "number" && (o.CALLBACK_PORT as number) > 0);
		if (hasClientId && !hasCallbackPort) {
			o.callback_port = CURSOR_CLI_CALLBACK_PORT;
		}
	}
}

export function parseCursorManifest(
	repoRoot: string,
	data: unknown,
	manifestDir: string = ".cursor-plugin",
): UnifiedPluginManifest {
	const record = isPlainObject(data) ? data : {};
	const name = typeof record.name === "string" ? record.name : "unknown";
	const skillEntries = parseSkillsField(
		repoRoot,
		parseSkillsRaw(record.skills),
		"skills",
	);
	const fallback = getProvider("cursor")?.mcp?.defaultMcpFallbackPath;
	const mcpServers = parseMcpServers(repoRoot, data, fallback, manifestDir);
	applyCursorCliLoopback(mcpServers);

	const knownSkillIds = new Set(skillEntries.map((s) => s.id));
	const commandEntries = parseCommandEntries(repoRoot, record);
	for (const c of commandEntries) knownSkillIds.add(c.id);

	const agentEntries = parseAgentEntries(repoRoot, record, knownSkillIds);
	const hookEntries = parseHookEntries(repoRoot, record).map((h) => ({
		...h,
		targetProvider: "cursor" as const,
	}));
	const ruleEntries = parseRuleEntries(repoRoot, record);
	const skippedArtifacts = detectSkippedArtifacts(repoRoot);

	return {
		name,
		version: typeof record.version === "string" ? record.version : undefined,
		description:
			typeof record.description === "string" ? record.description : undefined,
		provider: "cursor",
		skillEntries,
		commandEntries,
		agentEntries,
		hookEntries,
		ruleEntries,
		mcpServers,
		skippedArtifacts: skippedArtifacts.length > 0 ? skippedArtifacts : undefined,
	};
}
