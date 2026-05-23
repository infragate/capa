import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import {
  collectPluginSkillWarnings,
  collectUnreferencedPluginServerWarnings,
} from './helpers/tool-warnings';

export function validatePluginConfigTask(): Task<InstallCtx> {
  return {
    title: 'Validating plugin configuration',
    enabled: (ctx) =>
      !ctx.capabilities.plugins?.length &&
      ((ctx.capabilitiesToUse.resolvedPlugins?.length ?? 0) > 0 ||
        ctx.capabilitiesToUse.skills.some((s) => s.type === 'plugin')),
    task: async (ctx) => {
      ctx.warnings.push(...collectPluginSkillWarnings(ctx.capabilitiesToUse));
      ctx.warnings.push(...collectUnreferencedPluginServerWarnings(ctx.capabilitiesToUse));
    },
  };
}
