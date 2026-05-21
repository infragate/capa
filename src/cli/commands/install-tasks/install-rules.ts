import type { Task } from '../../ui';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { installRules } from '../../utils/rules-installer';
import { fetchRepoFile, fetchTextFile } from '../../../shared/repo-file';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../../shared/skill-security';
import type { CachePlatform } from '../../../shared/cache';
import type { InstallCtx } from './context';
import { getRepoSnapshot } from './helpers/repo-snapshot';

export function installRulesTask(): Task<InstallCtx> {
  return {
    title: 'Installing rules',
    enabled: (ctx) => (ctx.capabilitiesToUse.rules ?? []).length > 0,
    task: async (ctx, task) => {
      const currentRules = ctx.capabilitiesToUse.rules ?? [];
      const repoFetchAuth = createAuthenticatedFetch(ctx.db);
      const repoFetchCtx = {
        authFetch: repoFetchAuth,
        getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
          getRepoSnapshot(platform, repoPath, auth, opts),
        noCache: ctx.noCache,
      };
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      ctx.ruleBodies = new Map();

      const totalRules = currentRules.length;
      for (let i = 0; i < totalRules; i++) {
        const rule = currentRules[i];
        task.output = `[${i + 1}/${totalRules}] ${rule.id}`;

        let body: string;
        if (rule.type === 'inline') {
          if (!rule.content) throw new Error(`Rule "${rule.id}" is type 'inline' but has no content.`);
          body = rule.content;
        } else if (rule.type === 'remote') {
          if (!rule.url) throw new Error(`Rule "${rule.id}" is type 'remote' but has no url.`);
          body = await fetchTextFile(rule.url, {
            authFetch: repoFetchAuth,
            sourceLabel: `rule "${rule.id}"`,
          });
        } else if (rule.type === 'github' || rule.type === 'gitlab') {
          if (!rule.def?.repo) throw new Error(`Rule "${rule.id}" is type '${rule.type}' but missing def.repo.`);
          const result = await fetchRepoFile(
            rule.type,
            rule.def.repo,
            repoFetchCtx.getRepoSnapshot,
            repoFetchAuth,
            { noCache: ctx.noCache },
          );
          body = result.content;
        } else {
          throw new Error(`Unknown rule type: ${(rule as any).type}`);
        }
        const security = ctx.capabilitiesToUse.options?.security;
        if (isBlockedPhrasesEnabled(security)) {
          const blockedPhrases = loadBlockedPhrases(security, ctx.capabilitiesFile.path);
          const check = checkBlockedPhrases(body, blockedPhrases);
          if (check.blocked) {
            reportBlockedPhraseAndExit(rule.id, `rule:${rule.id}`, check.phrase!);
          }
        }
        if (isCharacterSanitizationEnabled(security)) {
          const allowedChars = getAllowedCharacters(security);
          if (allowedChars !== null) {
            body = sanitizeContent(body, allowedChars);
          }
        }
        ctx.ruleBodies.set(rule.id, body);
      }

      task.output = 'writing files…';
      installRules(ctx.projectPath, currentRules, providers, ctx.ruleBodies, {
        onFileWritten: (filePath) => ctx.db.addManagedFile(ctx.projectId, filePath),
      });
      ctx.added += currentRules.length;
      task.title = `Installed ${totalRules} rule${totalRules === 1 ? '' : 's'}`;
    },
  };
}
