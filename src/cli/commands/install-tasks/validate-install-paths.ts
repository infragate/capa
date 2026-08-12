import type { Task } from '../../ui';
import { validateProviderInstallRoots } from '../../../shared/install-path-guard';
import type { InstallCtx } from './context';

export function validateInstallPathsTask(): Task<InstallCtx> {
  return {
    id: 'validate-install-paths',
    title: 'Validate install paths',
    run: async (ctx) => {
      validateProviderInstallRoots(ctx.projectPath, ctx.resolvedProviders);
    },
  };
}
