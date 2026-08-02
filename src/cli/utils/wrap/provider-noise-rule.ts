import { getProviderOwnedTopLevelNames } from '../../../shared/providers';
import type { Rule } from '../../../types/rules';
import { installRules } from '../rules-installer';

export const WRAP_PROVIDER_NOISE_RULE_ID = 'capa-wrap-provider-noise';

/** Body telling the wrap agent to ignore provider-owned session files in VCS. */
export function buildWrapProviderNoiseRuleBody(providerIds: Iterable<string>): string {
  const names = [...getProviderOwnedTopLevelNames(providerIds)].sort((a, b) =>
    a.localeCompare(b),
  );
  const list =
    names.length > 0
      ? names.map((n) => `- \`${n}\``).join('\n')
      : '- (provider-owned config and instruction paths for this session)';

  return [
    'This session runs inside a capa wrap shadow workspace.',
    '',
    'Version control may show uncommitted files under provider-owned paths that belong to this agent session (capa-generated config, rules, hooks, instruction files) — not the user\'s project source.',
    '',
    'Do not review, edit for the user\'s project, commit, or treat as project source anything under:',
    '',
    list,
    '',
    'When summarizing version-control status, reviewing diffs, or deciding what to commit, ignore those paths.',
  ].join('\n');
}

/**
 * Inject an always-apply rule into the wrap workspace so the agent knows
 * provider-owned session files are wrap scaffolding, not project changes.
 */
export function installWrapProviderNoiseRule(
  workspacePath: string,
  wrapProviderId: string,
  exclusionProviderIds: Iterable<string>,
): void {
  const body = buildWrapProviderNoiseRuleBody(exclusionProviderIds);
  const rule: Rule = {
    id: WRAP_PROVIDER_NOISE_RULE_ID,
    type: 'inline',
    alwaysApply: true,
    description: 'Ignore capa wrap provider-owned session files in version control',
    content: body,
  };
  installRules(
    workspacePath,
    [rule],
    [wrapProviderId],
    new Map([[WRAP_PROVIDER_NOISE_RULE_ID, body]]),
    { quiet: true },
  );
}
