import type { Task } from "../../ui";
import { syncSystemActivityHooks } from "../../../shared/agent-activity-sync";
import type { InstallCtx } from "./context";

/**
 * Inject or prune capa-owned agent-activity hooks based on
 * `options.agentActivity` (default on).
 */
export function installSystemActivityHooksTask(): Task<InstallCtx> {
	return {
		title: "Syncing agent activity hooks",
		enabled: (ctx) =>
			(ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders).length > 0,
		task: async (ctx, task) => {
			const providers =
				ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
			try {
				const result = await syncSystemActivityHooks({
					projectPath: ctx.projectPath,
					projectId: ctx.projectId,
					capabilitiesFilePath: ctx.capabilitiesFile.path,
					capabilities: ctx.capabilitiesToUse,
					providers,
					db: ctx.db,
				});
				for (const w of result.warnings) ctx.warnings.push(w);
				if (!result.enabled) {
					task.title =
						result.removed > 0
							? `Agent activity hooks disabled (removed ${result.removed})`
							: "Agent activity hooks disabled";
					return;
				}
				task.title =
					result.installed > 0
						? `Agent activity hooks synced (${result.installed} entries)`
						: "Agent activity hooks up to date";
				if (result.installed > 0) ctx.added += result.installed;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.warnings.push(`Failed to sync agent activity hooks: ${message}`);
				task.title = "Agent activity hooks reported warnings";
			}
		},
	};
}
