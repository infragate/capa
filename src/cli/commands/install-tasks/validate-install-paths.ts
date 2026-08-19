import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { validateProviderInstallRoots } from '../../../shared/install-path-guard';
import { raiseInstallError } from './install-error-policy';

export function validateInstallPathsTask(): Task<InstallCtx> {
  return {
    title: 'Validating install paths',
    task: async (ctx) => {
      try {
        validateProviderInstallRoots(ctx.projectPath, ctx.resolvedProviders);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        raiseInstallError(ctx, message);
      }
    },
  };
}
