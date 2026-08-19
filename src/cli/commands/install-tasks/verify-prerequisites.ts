import type { Task } from '../../ui';
import type { RequiredCommand } from '../../../types/capabilities';
import type { InstallCtx } from './context';
import { checkRequiredCommand } from './helpers/required-command';
import { raiseInstallError } from './install-error-policy';

export function verifyPrerequisitesTask(reqCmds: RequiredCommand[]): Task<InstallCtx> {
  return {
    title: 'Verifying prerequisites',
    task: async (ctx, task) => {
      const total = reqCmds.length;
      let missing = 0;
      for (let i = 0; i < total; i++) {
        const cmd = reqCmds[i];
        task.output = `[${i + 1}/${total}] ${cmd.cli}${cmd.description ? ` — ${cmd.description}` : ''}`;
        try {
          await checkRequiredCommand(cmd);
        } catch (err: unknown) {
          missing++;
          const message = err instanceof Error ? err.message : String(err);
          raiseInstallError(ctx, message);
        }
      }
      if (missing > 0) {
        task.title = `Verifying prerequisites — ${missing} of ${total} missing`;
        return;
      }
      task.title = `Verified ${total} prerequisite${total === 1 ? '' : 's'}`;
    },
  };
}
