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
        for (const dir of tempDirsToCleanup) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {}
        }
      } catch (err: any) {
        if (err instanceof BlockedPhraseError) {
          reportBlockedPhraseAndExit(err.skillId, err.filePath, err.phrase, err.pluginName);
        }
        throw new Error(`Plugin resolution failed: ${err.message}`);
      }
      ctx.warnings.push(...collectPluginSkillWarnings(ctx.capabilitiesToUse));
      ctx.warnings.push(...collectUnreferencedPluginServerWarnings(ctx.capabilitiesToUse));
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      ctx.capabilitiesToUse.providers = providers;
    },
  };
}
