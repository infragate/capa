import type { Task } from '../../ui';
import { pruneRules } from '../../utils/rules-installer';
import type { InstallCtx } from './context';

export function pruneOrphanRulesTask(): Task<InstallCtx> {
  return {
    title: 'Pruning orphan rules',
    enabled: (ctx) => (ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders).length > 0,
    task: async (ctx) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const currentRules = ctx.capabilitiesToUse.rules ?? [];
      try {
        const previouslyManaged = ctx.db.getManagedFiles(ctx.projectId);
        const { removedFiles, removedMarkers } = pruneRules(
          ctx.projectPath,
          providers,
          currentRules,
          previouslyManaged,
        );
        for (const f of removedFiles) {
          ctx.db.removeManagedFile(ctx.projectId, f);
        }
        if (removedFiles.length + removedMarkers.length > 0) {
          ctx.added += removedFiles.length + removedMarkers.length;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.warnings.push(`Failed to prune orphan rules: ${message}`);
      }
    },
  };
}
