import type { Task } from '../../ui';
import { validateProviderInstallRoots } from '../../../shared/install-path-guard';
import type { InstallCtx } from './context';

export function validateInstallPathsTask(): Task<InstallCtx> {
  return {
    title: 'Validating install paths',
    task: async (ctx) => {
      validateProviderInstallRoots(ctx.projectPath, ctx.resolvedProviders);
    },
  };
}
