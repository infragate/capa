import type { Task } from '../../ui';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { installAgentsFile } from '../../utils/agents-file';
import type { CachePlatform } from '../../../shared/cache';
import type { InstallCtx } from './context';
import { getRepoSnapshot } from './helpers/repo-snapshot';

export function installAgentInstructionsTask(): Task<InstallCtx> {
  return {
    title: 'Installing agent instructions',
    enabled: (ctx) => !!ctx.capabilities.agents,
    task: async (ctx) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const repoFetchAuth = createAuthenticatedFetch(ctx.db);
      const repoFetchCtx = {
        authFetch: repoFetchAuth,
        getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
          getRepoSnapshot(platform, repoPath, auth, opts),
        noCache: ctx.noCache,
      };
      try {
        await installAgentsFile(
          ctx.projectPath,
          ctx.capabilities.agents!,
          providers,
          ctx.capabilitiesToUse.options?.security,
          ctx.capabilitiesFile.path,
          repoFetchCtx,
        );
      } catch (err: any) {
        throw new Error(`Failed to install agent instructions files: ${err.message}`);
      }
    },
  };
}
