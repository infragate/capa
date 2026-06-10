import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Task } from '../../ui';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { installRules } from '../../utils/rules-installer';
import { fetchRepoFile, fetchTextFile, type RepoSnapshotResolver } from '../../../shared/repo-file';
import type { Rule } from '../../../types/rules';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../../shared/skill-security';
import type { InstallCtx } from './context';
import { getRepoSnapshot } from './helpers/repo-snapshot';

/** Dependencies needed to resolve a rule's body content. */
export interface ResolveRuleBodyDeps {
  /** Absolute path of the capabilities file — resolves `local` rule paths. */
  capabilitiesFilePath: string;
  authFetch: AuthenticatedFetch;
  getRepoSnapshot: RepoSnapshotResolver;
  noCache?: boolean;
}

/**
 * Resolve a single rule's markdown body from its source.
 *
 *   - `inline`            : `content` is the literal body
 *   - `local`             : `path` is read from disk (relative to the capabilities file)
 *   - `remote`            : `url` is fetched at install time
 *   - `github` / `gitlab` : `def.repo` is cloned and the file read off the snapshot
 *
 * Throws a descriptive error when the required field for the type is missing or,
 * for `local`, when the referenced file does not exist.
 */
export async function resolveRuleBody(rule: Rule, deps: ResolveRuleBodyDeps): Promise<string> {
  if (rule.type === 'inline') {
    if (!rule.content) throw new Error(`Rule "${rule.id}" is type 'inline' but has no content.`);
    return rule.content;
  }
  if (rule.type === 'local') {
    if (!rule.path) throw new Error(`Rule "${rule.id}" is type 'local' but has no path.`);
    const baseDir = dirname(deps.capabilitiesFilePath);
    const fullPath = resolve(baseDir, rule.path);
    if (!existsSync(fullPath)) {
      throw new Error(
        `Rule "${rule.id}" local file not found: ${fullPath} (resolved from path "${rule.path}").`
      );
    }
    return readFileSync(fullPath, 'utf-8');
  }
  if (rule.type === 'remote') {
    if (!rule.url) throw new Error(`Rule "${rule.id}" is type 'remote' but has no url.`);
    return await fetchTextFile(rule.url, {
      authFetch: deps.authFetch,
      sourceLabel: `rule "${rule.id}"`,
    });
  }
  if (rule.type === 'github' || rule.type === 'gitlab') {
    if (!rule.def?.repo) throw new Error(`Rule "${rule.id}" is type '${rule.type}' but missing def.repo.`);
    const result = await fetchRepoFile(
      rule.type,
      rule.def.repo,
      deps.getRepoSnapshot,
      deps.authFetch,
      { noCache: deps.noCache }
    );
    return result.content;
  }
  throw new Error(`Unknown rule type: ${(rule as any).type}`);
}

export function installRulesTask(): Task<InstallCtx> {
  return {
    title: 'Installing rules',
    enabled: (ctx) => (ctx.capabilitiesToUse.rules ?? []).length > 0,
    task: async (ctx, task) => {
      const currentRules = ctx.capabilitiesToUse.rules ?? [];
      const repoFetchAuth = createAuthenticatedFetch(ctx.db);
      const snapshotResolver: RepoSnapshotResolver = (platform, repoPath, auth, opts) =>
        getRepoSnapshot(platform, repoPath, auth, opts);
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      ctx.ruleBodies = new Map();

      const totalRules = currentRules.length;
      for (let i = 0; i < totalRules; i++) {
        const rule = currentRules[i];
        task.output = `[${i + 1}/${totalRules}] ${rule.id}`;

        let body = await resolveRuleBody(rule, {
          capabilitiesFilePath: ctx.capabilitiesFile.path,
          authFetch: repoFetchAuth,
          getRepoSnapshot: snapshotResolver,
          noCache: ctx.noCache,
        });
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
