import type { PruneOrphanHooksOptions } from '../../../utils/hooks';
import type { InstallCtx } from '../context';

/** Providers whose project-local trees this install may create, update, or prune. */
export function materialInstallProviders(ctx: InstallCtx): string[] {
  if (ctx.isWrapInstall) {
    return ctx.resolvedProviders;
  }
  return ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
}

/** Scoped hook prune for wrap shadow installs (shared projectId, shadow paths only). */
export function wrapHookPruneOptions(ctx: InstallCtx): PruneOrphanHooksOptions | undefined {
  if (!ctx.isWrapInstall) return undefined;
  return {
    onlyDesiredProviders: true,
    mutateRoot: ctx.projectPath,
  };
}
