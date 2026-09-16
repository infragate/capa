import type { Task } from '../../ui';
import { pruneRules } from '../../utils/rules-installer';
import { resolveRuleConflictMode, type RuleDiagnostic } from '../../utils/rules-placement';
import type { InstallCtx } from './context';
import { materialInstallProviders } from './helpers/install-providers';
import { raiseInstallError } from './install-error-policy';

export function pruneOrphanRulesTask(): Task<InstallCtx> {
  return {
    title: 'Pruning orphan rules',
    enabled: (ctx) => materialInstallProviders(ctx).length > 0,
    task: async (ctx) => {
      const providers = materialInstallProviders(ctx);
      const currentRules = ctx.capabilitiesToUse.rules ?? [];
      let diagnostics: RuleDiagnostic[] = [];
      try {
        const previouslyManaged = ctx.db.getManagedFiles(ctx.projectId);
        const { removedFiles, removedMarkers, removedInstructionTargets, diagnostics: found } =
          pruneRules(ctx.projectPath, providers, currentRules, previouslyManaged, {
            trackedInstructionTargets: ctx.db.getManagedInstructionTargets(ctx.projectId),
            conflicts: resolveRuleConflictMode(ctx.capabilitiesToUse.options),
          });
        diagnostics = found;
        for (const f of removedFiles) {
          ctx.db.removeManagedFile(ctx.projectId, f);
        }
        for (const f of removedInstructionTargets) {
          ctx.db.removeManagedInstructionTarget(ctx.projectId, f);
        }
        if (removedFiles.length + removedMarkers.length > 0) {
          ctx.added += removedFiles.length + removedMarkers.length;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.warnings.push(`Failed to prune orphan rules: ${message}`);
      }

      // Placement conflicts are reported here, before any rule is written, so
      // `onInstallError: stop` aborts the install without partial rule output.
      for (const d of diagnostics) {
        if (d.level === 'error') {
          raiseInstallError(ctx, d.message);
        } else {
          ctx.warnings.push(d.message);
        }
      }
    },
  };
}
