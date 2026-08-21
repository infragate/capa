import { buildSkillDescriptions } from "../cli/commands/install-tasks/install-subagents";
import {
	installSubAgentInstructions,
	removeSubAgentInstructions,
} from "../cli/utils/agents-file/index";
import {
	purgeCursorSubAgentMCPEntries,
	registerSubAgentMCPServer,
	unregisterSubAgentMCPServer,
} from "../cli/utils/mcp-client-manager";
import type { CapaDatabase } from "../db/database";
import { getProvider } from "./providers";
import type { Capabilities } from "../types/capabilities";

export interface SyncSectionResult {
	installed: number;
	removed: number;
	warnings: string[];
}

/**
 * Materialize sub-agent files and MCP entries after a capabilities write.
 * Mirrors `installSubagentsTask` without CLI task scaffolding.
 */
export async function syncProjectSubagents(opts: {
	projectPath: string;
	projectId: string;
	capabilities: Capabilities;
	providers: string[];
	db: CapaDatabase;
	serverOrigin: string;
}): Promise<SyncSectionResult> {
	const warnings: string[] = [];
	const toolExposure = opts.capabilities.options?.toolExposure;
	const skipMcpWrites = toolExposure === "none";
	const installedAgents = opts.db.getSubAgents(opts.projectId);
	const currentSubagents = opts.capabilities.subagents ?? [];
	const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
	const removedAgents = installedAgents.filter(
		({ agent_id }) => !currentAgentIds.has(agent_id),
	);

	const agentsNeedingMcpCleanup = skipMcpWrites
		? installedAgents.map(({ agent_id }) => agent_id)
		: removedAgents.map(({ agent_id }) => agent_id);

	const needsPurge = opts.providers.some((id) => {
		const provider = getProvider(id);
		return (
			provider &&
			(provider.mcp?.supportsSubAgentEntries === false ||
				provider.purgeStaleSubAgentMcp === true)
		);
	});

	const skillDescriptions = buildSkillDescriptions(
		opts.projectPath,
		opts.capabilities,
		opts.providers,
	);

	let removed = 0;
	let installed = 0;

	if (needsPurge) {
		try {
			await purgeCursorSubAgentMCPEntries(opts.projectPath);
		} catch (err: unknown) {
			warnings.push(
				`Failed to purge stale sub-agent MCP entries: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const cleanupSet = new Set(agentsNeedingMcpCleanup);
	for (const { agent_id } of removedAgents) {
		try {
			await unregisterSubAgentMCPServer(
				opts.projectPath,
				agent_id,
				opts.providers,
			);
			removeSubAgentInstructions(opts.projectPath, agent_id, opts.providers);
			opts.db.removeSubAgent(opts.projectId, agent_id);
			removed++;
			cleanupSet.delete(agent_id);
		} catch (err: unknown) {
			warnings.push(
				`Failed to remove sub-agent "${agent_id}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	for (const agent_id of cleanupSet) {
		try {
			await unregisterSubAgentMCPServer(
				opts.projectPath,
				agent_id,
				opts.providers,
			);
		} catch (err: unknown) {
			warnings.push(
				`Failed to unregister MCP for sub-agent "${agent_id}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	for (const subAgent of currentSubagents) {
		try {
			if (!skipMcpWrites) {
				const agentMcpUrl = `${opts.serverOrigin}/${opts.projectId}/agents/${subAgent.id}/mcp`;
				await registerSubAgentMCPServer(
					opts.projectPath,
					subAgent.id,
					agentMcpUrl,
					opts.providers,
				);
			}
			installSubAgentInstructions(
				opts.projectPath,
				subAgent,
				opts.capabilities,
				opts.providers,
				skillDescriptions,
			);
			opts.db.upsertSubAgent(opts.projectId, subAgent.id);
			installed++;
		} catch (err: unknown) {
			warnings.push(
				`Failed to install sub-agent "${subAgent.id}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	return { installed, removed, warnings };
}
