import type { Task } from '../../ui';
import type { RequiredCommand } from '../../../types/capabilities';
import type { InstallCtx } from './context';
import { checkRequiredCommand } from './helpers/required-command';

export function verifyPrerequisitesTask(reqCmds: RequiredCommand[]): Task<InstallCtx> {
  return {
    title: 'Verifying prerequisites',
    task: async (_ctx, task) => {
      const total = reqCmds.length;
      for (let i = 0; i < total; i++) {
        const cmd = reqCmds[i];
        task.output = `[${i + 1}/${total}] ${cmd.cli}${cmd.description ? ` — ${cmd.description}` : ''}`;
        await checkRequiredCommand(cmd);
      }
      task.title = `Verified ${total} prerequisite${total === 1 ? '' : 's'}`;
    },
  };
}
