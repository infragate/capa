import type { Task } from '../../ui';
import { pruneOrphanHooks } from '../../utils/hooks-installer';
import { validateHooks } from '../../../shared/hooks-validate';
import {
  buildSystemActivityHooks,
  isAgentActivityEnabled,
} from '../../../shared/agent-activity';
import type { InstallCtx } from './context';

/**
 * Drop any `managed_hooks` entries whose hook is no longer declared in
 * `capabilities.hooks` (plus capa system activity hooks when enabled)
 * or whose provider is no longer in the active set.
 *
 * On wrap installs (`ctx.isWrapInstall`), only the providers being installed
 * into the shadow workspace are pruned — other providers' managed hooks on
 * the shared project identity (e.g. cursor after `capa wrap claude`) are kept.
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
      const { valid: userHooks } = validateHooks(rawHooks as unknown[]);
      const systemHooks = isAgentActivityEnabled(ctx.capabilitiesToUse.options)
        ? buildSystemActivityHooks(ctx.projectId)
        : [];
      const desiredHooks = [...userHooks, ...systemHooks];
      try {
        const { removed, warnings } = pruneOrphanHooks(
          ctx.projectPath,
          ctx.projectId,
          desiredHooks,
          providers,
          ctx.db,
          ctx.isWrapInstall
            ? { onlyDesiredProviders: true, mutateRoot: ctx.projectPath }
            : {},
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
