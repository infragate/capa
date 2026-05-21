import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { cleanupRemovedSkills } from './helpers/cleanup-removed-skills';

export function checkRemovedSkillsTask(): Task<InstallCtx> {
  return {
    title: 'Checking for removed skills',
    task: async (ctx) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
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
