import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { collectSubagentRefWarnings } from './helpers/tool-warnings';

/**
 * Surface a warning for each subagent that references a skill or tool id
 * not declared in the top-level `skills` / `tools` arrays. Otherwise these
 * typos pass silently through install and renderer, and only surface as
 * "the subagent can't find its tool" later at runtime.
 */
export function validateSubagentRefsTask(): Task<InstallCtx> {
  return {
    title: 'Validating sub-agent references',
    enabled: (ctx) => (ctx.capabilitiesToUse.subagents ?? []).length > 0,
    task: async (ctx) => {
      ctx.warnings.push(...collectSubagentRefWarnings(ctx.capabilitiesToUse));
    },
  };
}
