import { rmSync } from 'fs';
import type { Task } from '../../ui';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { BlockedPhraseError, reportBlockedPhraseAndExit } from '../../../shared/skill-security';
import { resolvePlugins } from '../plugin-install';
import type { InstallCtx } from './context';
import { getRepoSnapshot } from './helpers/repo-snapshot';
import {
  collectPluginSkillWarnings,
  collectUnreferencedPluginServerWarnings,
} from './helpers/tool-warnings';
import { raiseInstallError } from './install-error-policy';

export function resolvePluginsTask(): Task<InstallCtx> {
  return {
    title: 'Resolving plugins',
    enabled: (ctx) => !!(ctx.capabilities.plugins && ctx.capabilities.plugins.length > 0),
    task: async (ctx) => {
      const authFetch = createAuthenticatedFetch(ctx.db);
      try {
        const { mergedCapabilities, tempDirsToCleanup, warnings: pluginWarnings } =
          await resolvePlugins(
            ctx.capabilities,
            ctx.projectPath,
            ctx.projectId,
            authFetch,
            ctx.db,
            (platform, repoPath, auth, opts) => getRepoSnapshot(platform, repoPath, auth, opts),
            ctx.capabilitiesFile.path,
            ctx.lockBuilder,
            { noCache: ctx.noCache },
          );
        ctx.capabilitiesToUse = mergedCapabilities;
        ctx.warnings.push(...pluginWarnings);
        const declaredPlugins = ctx.capabilities.plugins?.length ?? 0;
        const resolvedPlugins = ctx.capabilitiesToUse.resolvedPlugins?.length ?? 0;
        const pluginFailures = pluginWarnings.filter((w) =>
          w.includes('failed to resolve and was skipped'),
        );
        // When every declared plugin fails, treat install as failed — but keep
        // partial success when at least one plugin resolved (isolation).
        if (declaredPlugins > 0 && resolvedPlugins === 0 && pluginFailures.length > 0) {
          raiseInstallError(ctx, pluginFailures.join('\n'));
          return;
        }
        for (const dir of tempDirsToCleanup) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {}
        }
      } catch (err: any) {
        if (err instanceof BlockedPhraseError) {
          reportBlockedPhraseAndExit(err.skillId, err.filePath, err.phrase, err.pluginName);
        }
        raiseInstallError(ctx, `Plugin resolution failed: ${err.message}`);
        return;
      }
      ctx.warnings.push(...collectPluginSkillWarnings(ctx.capabilitiesToUse));
      ctx.warnings.push(...collectUnreferencedPluginServerWarnings(ctx.capabilitiesToUse));
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      ctx.capabilitiesToUse.providers = providers;
    },
  };
}
