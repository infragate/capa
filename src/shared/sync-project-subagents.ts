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
import type { InstalledSubAgent } from "../db/sub-agents";
import type { Capabilities } from "../types/capabilities";
import { canonicalizePath } from "./paths";
import { getProvider } from "./providers";
import {
	getSubAgentProviderWarnings,
	resolvePreviousSubAgentProviders,
	resolveSubAgentProviders,
} from "./subagent-providers";

export interface SyncSectionResult {
	installed: number;
	removed: number;
	warnings: string[];
}

function providersInstalledAt(
	agent: InstalledSubAgent,
	installPath: string,
): string[] | undefined {
	return agent.installations.find(
		(installation) => installation.install_path === installPath,
	)?.provider_ids;
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
	materializeShadow?: boolean;
	previousProviders?: string[];
}): Promise<SyncSectionResult> {
	const warnings: string[] = [];
	const toolExposure = opts.capabilities.options?.toolExposure;
	const skipMcpWrites = toolExposure === "none";
	const installPath = canonicalizePath(opts.projectPath);
	const installedAgents = opts.db.getSubAgents(opts.projectId);
	const currentSubagents = opts.capabilities.subagents ?? [];
	const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
	const removedAgents = installedAgents.filter(
		(agent) =>
			!currentAgentIds.has(agent.agent_id) &&
			(agent.legacy_unscoped || providersInstalledAt(agent, installPath)),
	);
	const installedById = new Map(
		installedAgents.map((agent) => [agent.agent_id, agent]),
	);
	const lifecycleProviders = [
		...new Set([
			...opts.providers,
			...installedAgents.flatMap(
				(installedAgent) =>
					resolvePreviousSubAgentProviders({
						installedAgent,
						installPath,
						activeProviders: opts.providers,
						previousProjectProviders:
							opts.previousProviders ??
							opts.db.getProjectProviders(opts.projectId),
						isWrapInstall: opts.materializeShadow === true,
					}),
			),
		]),
	];

	const needsPurge = lifecycleProviders.some((id) => {
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
			await purgeCursorSubAgentMCPEntries(opts.projectPath, opts.projectId);
		} catch (err: unknown) {
			warnings.push(
				`Failed to purge stale sub-agent MCP entries: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	for (const installedAgent of removedAgents) {
		const { agent_id } = installedAgent;
		const previousProviders = resolvePreviousSubAgentProviders({
			installedAgent,
			installPath,
			activeProviders: opts.providers,
			previousProjectProviders:
				opts.previousProviders ?? opts.db.getProjectProviders(opts.projectId),
			isWrapInstall: opts.materializeShadow === true,
		});
		try {
			await unregisterSubAgentMCPServer(
				opts.projectPath,
				agent_id,
				previousProviders,
				opts.projectId,
			);
			removeSubAgentInstructions(opts.projectPath, agent_id, previousProviders);
			opts.db.removeSubAgentInstallation(
				opts.projectId,
				agent_id,
				{
					installPath,
					removeLegacy: opts.materializeShadow !== true,
				},
			);
			removed++;
		} catch (err: unknown) {
			warnings.push(
				`Failed to remove sub-agent "${agent_id}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	for (const subAgent of currentSubagents) {
		try {
			const targets = resolveSubAgentProviders(
				subAgent,
				opts.providers,
			);
			const { supported } = targets;
			warnings.push(...getSubAgentProviderWarnings(subAgent, targets));

			const previous = installedById.get(subAgent.id);
			const previousProviders = previous
				? resolvePreviousSubAgentProviders({
						installedAgent: previous,
						installPath,
						activeProviders: opts.providers,
						previousProjectProviders:
							opts.previousProviders ??
							opts.db.getProjectProviders(opts.projectId),
						isWrapInstall: opts.materializeShadow === true,
					})
				: [];
			const staleProviders = previousProviders.filter(
				(providerId) => !supported.includes(providerId),
			);
			if (staleProviders.length > 0) {
				await unregisterSubAgentMCPServer(
					opts.projectPath,
					subAgent.id,
					staleProviders,
					opts.projectId,
				);
				removeSubAgentInstructions(
					opts.projectPath,
					subAgent.id,
					staleProviders,
				);
			}

			if (skipMcpWrites) {
				await unregisterSubAgentMCPServer(
					opts.projectPath,
					subAgent.id,
					supported,
					opts.projectId,
				);
			} else {
				const agentMcpUrl = `${opts.serverOrigin}/${opts.projectId}/agents/${subAgent.id}/mcp`;
				await registerSubAgentMCPServer(
					opts.projectPath,
					subAgent.id,
					agentMcpUrl,
					supported,
				);
			}
			installSubAgentInstructions(
				opts.projectPath,
				subAgent,
				opts.capabilities,
				supported,
				skillDescriptions,
			);
			opts.db.upsertSubAgent(
				opts.projectId,
				subAgent.id,
				{
					installPath,
					providerIds: supported,
					migrateLegacy: opts.materializeShadow !== true,
				},
			);
			if (supported.length > 0) installed++;
		} catch (err: unknown) {
			warnings.push(
				`Failed to install sub-agent "${subAgent.id}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	return { installed, removed, warnings };
}
