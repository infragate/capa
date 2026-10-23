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
import { raiseInstallError, recordInstallFailure } from './install-error-policy';

/**
 * Report what resolvePlugins returned. A plugin that failed to resolve is an
 * install failure, so `capa status` and `--strict` see it, and is reported
 * once, not also as a warning. Returns false when every declared plugin
 * failed: the install has failed. Otherwise the plugins that resolved still
 * install (isolation).
 */
export function reportPluginResults(ctx: InstallCtx, pluginWarnings: string[]): boolean {
  const failures = pluginWarnings.filter((w) => w.includes('failed to resolve and was skipped'));
  ctx.warnings.push(...pluginWarnings.filter((w) => !failures.includes(w)));
  const declared = ctx.capabilities.plugins?.length ?? 0;
  const resolved = ctx.capabilitiesToUse.resolvedPlugins?.length ?? 0;
  if (declared > 0 && resolved === 0 && failures.length > 0) {
    raiseInstallError(ctx, failures.join('\n'));
    return false;
  }
  for (const failure of failures) recordInstallFailure(ctx, failure);
  return true;
}

export function resolvePluginsTask(): Task<InstallCtx> {
  return {
    title: 'Resolving plugins',
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
        if (!reportPluginResults(ctx, pluginWarnings)) return;
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
