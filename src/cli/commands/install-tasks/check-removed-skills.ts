import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { cleanupRemovedSkills } from './helpers/cleanup-removed-skills';

export function checkRemovedSkillsTask(): Task<InstallCtx> {
  return {
    title: 'Checking for removed skills',
    task: async (ctx) => {
      // Wrap shares projectId with the real install; cleanupRemovedSkills only
      // deletes provider skill dirs under ctx.projectPath (the shadow workspace).
      const providers = ctx.isWrapInstall
        ? ctx.resolvedProviders
        : (ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders);
      const stats = await cleanupRemovedSkills(
        ctx.projectPath,
        ctx.projectId,
        ctx.capabilitiesToUse.skills,
        providers,
        ctx.db,
      );
      ctx.skipped += stats.skipped;
      ctx.added += stats.removed;
    },
  };
}
