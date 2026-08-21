import { getRepoSnapshot } from "../cli/commands/install-tasks/helpers/repo-snapshot";
import { resolveRuleBody } from "../cli/commands/install-tasks/install-rules";
import { installAgentsFile, cleanAgentInstructionSnippets } from "../cli/utils/agents-file/index";
import {
	installHooks,
	pruneOrphanHooks,
	type PruneOrphanHooksOptions,
} from "../cli/utils/hooks";
import { installRules, pruneRules } from "../cli/utils/rules-installer";
import { listWrapWorkspacesForProject } from "../cli/utils/wrap/workspace";
import type { CapaDatabase } from "../db/database";
import { syncSystemActivityHooks } from "../shared/agent-activity-sync";
import {
	buildSystemActivityHooks,
	isAgentActivityEnabled,
} from "../shared/agent-activity";
import { createAuthenticatedFetch } from "../shared/authenticated-fetch";
import { validateHooks } from "../shared/hooks-validate";
import { validateProvider } from "../shared/providers/resolve";
import {
	syncProjectSubagents,
	type SyncSectionResult,
} from "../shared/sync-project-subagents";
import {
	checkBlockedPhrases,
	getAllowedCharacters,
	isBlockedPhrasesEnabled,
	isCharacterSanitizationEnabled,
	loadBlockedPhrases,
	sanitizeContent,
} from "../shared/skill-security";
import type { Capabilities } from "../types/capabilities";
import type { Rule } from "../types/rules";
import { resolveProvidersForServer } from "./resolve-effective-capabilities";

export type { SyncSectionResult };

export interface SyncProjectArtifactsResult {
	hooks: SyncSectionResult;
	rules: SyncSectionResult;
	agents: SyncSectionResult;
	subagents: SyncSectionResult;
	skipped: boolean;
}

/**
 * Materialize managed artifacts for one project tree (typically a wrap shadow).
 * The real project source tree is updated only by `capa install`, not UI sync.
 */
export async function syncProjectManagedArtifacts(opts: {
	projectPath: string;
	projectId: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	db: CapaDatabase;
	serverOrigin: string;
	providers?: string[];
	pruneOptions?: PruneOrphanHooksOptions;
	/** True when writing into a wrap shadow workspace (always re-render). */
	materializeShadow?: boolean;
}): Promise<SyncProjectArtifactsResult> {
	const empty: SyncSectionResult = { installed: 0, removed: 0, warnings: [] };
	const providers =
		opts.providers ??
		resolveProvidersForServer(opts.capabilities, opts.db, opts.projectId);
	if (!providers || providers.length === 0) {
		return {
			hooks: {
				...empty,
				warnings: ["No providers configured — skipped hook install"],
			},
			rules: {
				...empty,
				warnings: ["No providers configured — skipped rule install"],
			},
			agents: {
				...empty,
				warnings: ["No providers configured — skipped agent instructions"],
			},
			subagents: {
				...empty,
				warnings: ["No providers configured — skipped sub-agent install"],
			},
			skipped: true,
		};
	}

	const hooks = await syncProjectHooks({
		...opts,
		providers,
		pruneOptions: opts.pruneOptions,
	});
	const rules = await syncProjectRules({
		...opts,
		providers,
	});
	const agents = await syncProjectAgentInstructions({
		...opts,
		providers,
		materializeShadow: opts.materializeShadow === true,
	});
	const subagents = await syncProjectSubagents({
		projectPath: opts.projectPath,
		projectId: opts.projectId,
		capabilities: opts.capabilities,
		providers,
		db: opts.db,
		serverOrigin: opts.serverOrigin,
	});

	return { hooks, rules, agents, subagents, skipped: false };
}

function mergeSyncSections(
	a: SyncSectionResult,
	b: SyncSectionResult,
): SyncSectionResult {
	return {
		installed: a.installed + b.installed,
		removed: a.removed + b.removed,
		warnings: [...a.warnings, ...b.warnings],
	};
}

/**
 * Re-render managed artifacts in active wrap shadow workspaces when capabilities
 * change (Web UI / configure). The source project directory is never mutated here —
 * run `capa install` for that.
 */
export async function syncProjectManagedArtifactsAndWrapShadows(opts: {
	projectPath: string;
	projectId: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	db: CapaDatabase;
	serverOrigin: string;
}): Promise<SyncProjectArtifactsResult> {
	const empty: SyncSectionResult = { installed: 0, removed: 0, warnings: [] };
	let hooks: SyncSectionResult = { ...empty };
	let rules: SyncSectionResult = { ...empty };
	let agents: SyncSectionResult = { ...empty };
	let subagents: SyncSectionResult = { ...empty };
	let skipped = true;

	const shadows = await listWrapWorkspacesForProject(opts.projectPath);
	for (const shadow of shadows) {
		const shadowResult = await syncProjectManagedArtifacts({
			...opts,
			projectPath: shadow.workspacePath,
			providers: [validateProvider(shadow.providerId)],
			pruneOptions: {
				onlyDesiredProviders: true,
				mutateRoot: shadow.workspacePath,
			},
			materializeShadow: true,
		});
		hooks = mergeSyncSections(hooks, shadowResult.hooks);
		rules = mergeSyncSections(rules, shadowResult.rules);
		agents = mergeSyncSections(agents, shadowResult.agents);
		subagents = mergeSyncSections(subagents, shadowResult.subagents);
		if (!shadowResult.skipped) skipped = false;
	}

	return { hooks, rules, agents, subagents, skipped };
}

async function syncProjectHooks(opts: {
	projectPath: string;
	projectId: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	db: CapaDatabase;
	providers: string[];
	pruneOptions?: PruneOrphanHooksOptions;
}): Promise<SyncSectionResult> {
	const warnings: string[] = [];
	const rawHooks = opts.capabilities.hooks ?? [];
	const { valid: userHooks, issues } = validateHooks(rawHooks as unknown[]);
	for (const issue of issues) {
		const prefix = issue.hookId ? `Hook "${issue.hookId}": ` : "Hook: ";
		warnings.push(`${prefix}${issue.message} (skipped)`);
	}

	const systemHooks = isAgentActivityEnabled(opts.capabilities.options)
		? buildSystemActivityHooks(opts.projectId)
		: [];
	const desiredHooks = [...userHooks, ...systemHooks];

	let removed = 0;
	try {
		const prune = pruneOrphanHooks(
			opts.projectPath,
			opts.projectId,
			desiredHooks,
			opts.providers,
			opts.db,
			opts.pruneOptions ?? {},
		);
		removed += prune.removed;
		warnings.push(...prune.warnings);
	} catch (err: unknown) {
		warnings.push(
			`Failed to prune orphan hooks: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let installed = 0;
	if (userHooks.length > 0) {
		try {
			const authFetch = createAuthenticatedFetch(opts.db);
			const result = await installHooks({
				projectPath: opts.projectPath,
				projectId: opts.projectId,
				capabilitiesFilePath: opts.capabilitiesFilePath,
				hooks: userHooks,
				providers: opts.providers,
				db: opts.db,
				authFetch,
				getRepoSnapshot: (platform, repoPath, auth, snapOpts) =>
					getRepoSnapshot(platform, repoPath, auth, snapOpts),
				quiet: true,
			});
			installed += result.installed;
			warnings.push(...result.warnings);
		} catch (err: unknown) {
			warnings.push(
				`Failed to install hooks: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	try {
		const activity = await syncSystemActivityHooks({
			projectPath: opts.projectPath,
			projectId: opts.projectId,
			capabilitiesFilePath: opts.capabilitiesFilePath,
			capabilities: opts.capabilities,
			providers: opts.providers,
			db: opts.db,
			quiet: true,
			pruneOptions: opts.pruneOptions,
		});
		installed += activity.installed;
		removed += activity.removed;
		warnings.push(...activity.warnings);
	} catch (err: unknown) {
		warnings.push(
			`Failed to sync agent activity hooks: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return { installed, removed, warnings };
}

async function syncProjectRules(opts: {
	projectPath: string;
	projectId: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	db: CapaDatabase;
	providers: string[];
}): Promise<SyncSectionResult> {
	const warnings: string[] = [];
	const currentRules = opts.capabilities.rules ?? [];
	let removed = 0;
	let installed = 0;

	try {
		const previouslyManaged = opts.db.getManagedFiles(opts.projectId);
		const { removedFiles, removedMarkers } = pruneRules(
			opts.projectPath,
			opts.providers,
			currentRules,
			previouslyManaged,
		);
		for (const file of removedFiles) {
			opts.db.removeManagedFile(opts.projectId, file);
		}
		removed += removedFiles.length + removedMarkers.length;
	} catch (err: unknown) {
		warnings.push(
			`Failed to prune orphan rules: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (currentRules.length === 0) {
		return { installed, removed, warnings };
	}

	const authFetch = createAuthenticatedFetch(opts.db);
	const ruleBodies = new Map<string, string>();
	const installedRules: Rule[] = [];
	const security = opts.capabilities.options?.security;

	for (const rule of currentRules) {
		try {
			let body = await resolveRuleBody(rule, {
				capabilitiesFilePath: opts.capabilitiesFilePath,
				authFetch,
				getRepoSnapshot: (platform, repoPath, auth, snapOpts) =>
					getRepoSnapshot(platform, repoPath, auth, snapOpts),
			});
			if (isBlockedPhrasesEnabled(security)) {
				const blockedPhrases = loadBlockedPhrases(
					security,
					opts.capabilitiesFilePath,
				);
				const check = checkBlockedPhrases(body, blockedPhrases);
				if (check.blocked) {
					warnings.push(
						`Rule "${rule.id}" blocked phrase "${check.phrase}" (skipped)`,
					);
					continue;
				}
			}
			if (isCharacterSanitizationEnabled(security)) {
				const allowedChars = getAllowedCharacters(security);
				if (allowedChars !== null) {
					body = sanitizeContent(body, allowedChars);
				}
			}
			ruleBodies.set(rule.id, body);
			installedRules.push(rule);
		} catch (err: unknown) {
			warnings.push(
				`Rule "${rule.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (installedRules.length > 0) {
		try {
			installRules(
				opts.projectPath,
				installedRules,
				opts.providers,
				ruleBodies,
				{ quiet: true },
			);
			installed += installedRules.length;
		} catch (err: unknown) {
			warnings.push(
				`Failed to install rules: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	return { installed, removed, warnings };
}

async function syncProjectAgentInstructions(opts: {
	projectPath: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	db: CapaDatabase;
	providers: string[];
	materializeShadow?: boolean;
}): Promise<SyncSectionResult> {
	const warnings: string[] = [];
	const config = opts.capabilities.agents;

	if (!config) {
		try {
			const removed = cleanAgentInstructionSnippets(
				opts.projectPath,
				opts.providers,
			);
			return { installed: 0, removed, warnings };
		} catch (err: unknown) {
			warnings.push(
				`Failed to clear agent instructions: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		return { installed: 0, removed: 0, warnings };
	}

	const hasContent =
		!!config.base || (config.additional?.length ?? 0) > 0;
	if (!hasContent) {
		try {
			const removed = cleanAgentInstructionSnippets(
				opts.projectPath,
				opts.providers,
			);
			return { installed: 0, removed, warnings };
		} catch (err: unknown) {
			warnings.push(
				`Failed to clear agent instructions: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		return { installed: 0, removed: 0, warnings };
	}

	try {
		const authFetch = createAuthenticatedFetch(opts.db);
		await installAgentsFile(
			opts.projectPath,
			config,
			opts.providers,
			opts.capabilities.options?.security,
			opts.capabilitiesFilePath,
			{
				authFetch,
				getRepoSnapshot: (platform, repoPath, auth, snapOpts) =>
					getRepoSnapshot(platform, repoPath, auth, snapOpts),
				quiet: true,
				forceMaterialize: opts.materializeShadow === true,
				onBlockedPhrase: (sourceLabel, phrase) => {
					throw new Error(
						`blocked phrase "${phrase}" in ${sourceLabel}`,
					);
				},
			},
		);
		const snippetCount =
			(config.additional?.length ?? 0) + (config.base ? 1 : 0);
		return {
			installed: snippetCount > 0 ? snippetCount : 1,
			removed: 0,
			warnings,
		};
	} catch (err: unknown) {
		warnings.push(
			`Failed to install agent instructions: ${err instanceof Error ? err.message : String(err)}`,
		);
		return { installed: 0, removed: 0, warnings };
	}
}
