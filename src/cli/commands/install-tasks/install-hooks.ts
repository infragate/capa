import type { Task } from '../../ui';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { installHooks } from '../../utils/hooks-installer';
import { validateHooks } from '../../../shared/hooks-validate';
import type { CachePlatform } from '../../../shared/cache';
import type { InstallCtx } from './context';
import { getRepoSnapshot } from './helpers/repo-snapshot';

export function installHooksTask(): Task<InstallCtx> {
  return {
    title: 'Installing hooks',
    enabled: (ctx) => (ctx.capabilitiesToUse.hooks ?? []).length > 0,
    task: async (ctx, task) => {
      const rawHooks = ctx.capabilitiesToUse.hooks ?? [];
      const { valid, issues } = validateHooks(rawHooks as unknown[]);
      for (const issue of issues) {
        const prefix = issue.hookId ? `Hook "${issue.hookId}": ` : 'Hook: ';
        ctx.warnings.push(`${prefix}${issue.message} (skipping)`);
      }
      if (valid.length === 0) {
        task.title = 'No valid hooks to install';
        return;
      }

      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const repoFetchAuth = createAuthenticatedFetch(ctx.db);
      task.output = `${valid.length} hook${valid.length === 1 ? '' : 's'} → ${providers.length} provider${providers.length === 1 ? '' : 's'}`;

      try {
        const { installed, warnings } = await installHooks({
          projectPath: ctx.projectPath,
          projectId: ctx.projectId,
          capabilitiesFilePath: ctx.capabilitiesFile.path,
          hooks: valid,
          providers,
          db: ctx.db,
          authFetch: repoFetchAuth,
          getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
            getRepoSnapshot(platform, repoPath, auth, opts),
          noCache: ctx.noCache,
          lockBuilder: ctx.lockBuilder,
        });
        for (const w of warnings) ctx.warnings.push(w);
        ctx.added += installed;
        task.title = installed > 0
          ? `Installed ${installed} hook entr${installed === 1 ? 'y' : 'ies'}`
          : 'Hooks up to date';
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Warn-but-never-fail: the rest of `capa install` should still finish.
        ctx.warnings.push(`Failed to install hooks: ${message}`);
        task.title = 'Hooks install reported warnings';
      }
    },
  };
}
