import type { Task } from '../../ui';
import { pruneOrphanHooks } from '../../utils/hooks-installer';
import { validateHooks } from '../../../shared/hooks-validate';
import type { InstallCtx } from './context';

/**
 * Drop any `managed_hooks` entries whose hook is no longer declared in
 * `capabilities.hooks` or whose provider is no longer in the active set.
 *
 * Runs *before* `install-hooks` so installs always converge on the
 * requested state — a hook moved from `cursor` to `claude-code` results
 * in a removal on cursor and an install on claude-code in the same run.
 */
export function pruneOrphanHooksTask(): Task<InstallCtx> {
  return {
    title: 'Pruning orphan hooks',
    enabled: (ctx) => (ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders).length > 0,
    task: async (ctx) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const rawHooks = ctx.capabilitiesToUse.hooks ?? [];
      // Validate at this point too so an invalid hook doesn't make the
      // prune think it's still desired (and skip the orphan).
      const { valid: desiredHooks } = validateHooks(rawHooks as unknown[]);
      try {
        const { removed, warnings } = pruneOrphanHooks(
          ctx.projectPath,
          ctx.projectId,
          desiredHooks,
          providers,
          ctx.db,
        );
        for (const w of warnings) ctx.warnings.push(w);
        if (removed > 0) {
          ctx.added += removed;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.warnings.push(`Failed to prune orphan hooks: ${message}`);
      }
    },
  };
}
