import type { UnifiedPluginManifest } from "../../../types/plugin";

/** Lightweight inventory of what a plugin unpacks into capa. */
export interface PluginContentsSummary {
	skills: string[];
	/** Legacy commands (installed as skills). */
	commands: string[];
	agents: string[];
	hooks: string[];
	rules: string[];
	mcpServers: string[];
	skippedArtifacts: string[];
}

export function summarizeUnifiedManifest(
	manifest: UnifiedPluginManifest,
): PluginContentsSummary {
	return {
		skills: manifest.skillEntries.map((s) => s.id).sort(),
		commands: (manifest.commandEntries ?? []).map((c) => c.id).sort(),
		agents: (manifest.agentEntries ?? []).map((a) => a.id).sort(),
		hooks: (manifest.hookEntries ?? []).map((h) => h.idHint || h.event).sort(),
		rules: (manifest.ruleEntries ?? []).map((r) => r.id).sort(),
		mcpServers: Object.keys(manifest.mcpServers).sort(),
		skippedArtifacts: [...(manifest.skippedArtifacts ?? [])].sort(),
	};
}

export function isEmptyPluginContents(summary: PluginContentsSummary): boolean {
	return (
		summary.skills.length === 0 &&
		summary.commands.length === 0 &&
		summary.agents.length === 0 &&
		summary.hooks.length === 0 &&
		summary.rules.length === 0 &&
		summary.mcpServers.length === 0 &&
		summary.skippedArtifacts.length === 0
	);
}

function listSection(title: string, items: string[]): string[] {
	if (items.length === 0) return [];
	const lines = [`### ${title}`, ""];
	for (const id of items) {
		lines.push(`- \`${id}\``);
	}
	lines.push("");
	return lines;
}

/**
 * Markdown section describing what capa will unpack from this plugin.
 */
export function formatPluginContentsMarkdown(
	summary: PluginContentsSummary,
): string {
	if (isEmptyPluginContents(summary)) {
		return [
			"## Contents",
			"",
			"_No skills, agents, hooks, rules, or MCP servers were detected in this plugin._",
			"",
		].join("\n");
	}

	const parts: string[] = ["## Contents", ""];
	parts.push(
		...listSection("Skills", summary.skills),
		...listSection("Commands (as skills)", summary.commands),
		...listSection("Sub-agents", summary.agents),
		...listSection("Hooks", summary.hooks),
		...listSection("Rules", summary.rules),
		...listSection("MCP servers", summary.mcpServers),
	);
	if (summary.skippedArtifacts.length > 0) {
		parts.push("### Not installed by capa", "");
		for (const kind of summary.skippedArtifacts) {
			parts.push(`- \`${kind}\``);
		}
		parts.push("");
	}
	return parts.join("\n");
}

/** Paths suitable for the registry detail file tree. */
export function pluginContentsToFiles(summary: PluginContentsSummary): string[] {
	const files: string[] = [];
	for (const id of summary.skills) files.push(`skills/${id}/`);
	for (const id of summary.commands) files.push(`commands/${id}.md`);
	for (const id of summary.agents) files.push(`agents/${id}.md`);
	for (const id of summary.hooks) files.push(`hooks/${id}`);
	for (const id of summary.rules) files.push(`rules/${id}`);
	for (const id of summary.mcpServers) files.push(`mcp/${id}`);
	return files;
}
