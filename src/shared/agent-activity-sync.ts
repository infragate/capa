/**
 * Inject or prune capa system activity hooks for a project.
 * Shared by `capa install` and the Activity hooks/sync API.
 */

import type { CapaDatabase } from "../db/database";
import type { Capabilities } from "../types/capabilities";
import { createAuthenticatedFetch } from "./authenticated-fetch";
import {
	buildSystemActivityHooks,
	isAgentActivityEnabled,
} from "./agent-activity";
import { validateHooks } from "./hooks-validate";
import {
	installHooks,
	pruneOrphanHooks,
	type PruneOrphanHooksOptions,
} from "../cli/utils/hooks";

export interface SyncSystemActivityHooksResult {
	enabled: boolean;
	installed: number;
	removed: number;
	warnings: string[];
}

export async function syncSystemActivityHooks(opts: {
	projectPath: string;
	projectId: string;
	capabilitiesFilePath: string;
	capabilities: Capabilities;
	providers: string[];
	db: CapaDatabase;
	/** Suppress CLI-style install logs (server / API callers). */
	quiet?: boolean;
	/** Optional scoped prune (wrap shadow installs). */
	pruneOptions?: PruneOrphanHooksOptions;
}): Promise<SyncSystemActivityHooksResult> {
	const warnings: string[] = [];
	const enabled = isAgentActivityEnabled(opts.capabilities.options);
	const { valid: userHooks, issues } = validateHooks(
		(opts.capabilities.hooks ?? []) as unknown[],
	);
	for (const issue of issues) {
		const prefix = issue.hookId ? `Hook "${issue.hookId}": ` : "Hook: ";
		warnings.push(`${prefix}${issue.message} (skipped from activity sync)`);
	}

	let removed = 0;
	const systemHooks = enabled
		? buildSystemActivityHooks(opts.projectId)
		: [];
	const desiredHooks = [...userHooks, ...systemHooks];
	const prune = pruneOrphanHooks(
		opts.projectPath,
		opts.projectId,
		desiredHooks,
		opts.providers,
		opts.db,
		opts.pruneOptions ?? {},
	);
	warnings.push(...prune.warnings);
	removed = prune.removed;

	let installed = 0;
	if (enabled && opts.providers.length > 0) {
		const authFetch = createAuthenticatedFetch(opts.db);
		for (const providerId of opts.providers) {
			const hooks = buildSystemActivityHooks(opts.projectId, providerId);
			const result = await installHooks({
				projectPath: opts.projectPath,
				projectId: opts.projectId,
				capabilitiesFilePath: opts.capabilitiesFilePath,
				hooks,
				providers: [providerId],
				db: opts.db,
				authFetch,
				quiet: opts.quiet,
				getRepoSnapshot: async () => {
					throw new Error("system activity hooks do not fetch remote sources");
				},
			});
			installed += result.installed;
			warnings.push(...result.warnings);
		}
	}

	return {
		enabled,
		installed,
		removed,
		warnings,
	};
}
