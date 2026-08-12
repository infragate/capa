import { getProviderOwnedTopLevelNames } from '../../../shared/providers';
import type { Rule } from '../../../types/rules';
import { installRules } from '../rules-installer';

export const WRAP_PROVIDER_NOISE_RULE_ID = 'capa-wrap-provider-noise';

/** Body telling the wrap agent how the shadow workspace is set up. */
export function buildWrapProviderNoiseRuleBody(providerIds: Iterable<string>): string {
  const names = [...getProviderOwnedTopLevelNames(providerIds)].sort((a, b) =>
    a.localeCompare(b),
  );
  const list =
    names.length > 0
      ? names.map((n) => `- \`${n}\``).join('\n')
      : '- (provider-owned config and instruction paths for this session)';

  return [
    'This session runs inside a **capa wrap shadow workspace** — an isolated working copy of the project for agent work.',
    '',
    '## How this workspace is set up',
    '',
    '- Project source (e.g. `src/`, `docs/`, user config) is symlinked from the real project. Edits through those paths update the real project normally.',
    '- Provider/agent paths listed below are **shadow-only**. They exist only in this workspace and are not part of the user\'s source tree.',
    '- **Git works normally** — status, diff, commit, and branch operations apply to the real repository. Ignore capa-generated paths when deciding what to commit.',
    '',
    '## Ignore these paths in version control',
    '',
    'Do not review, edit for the user\'s project, commit, or treat as project source anything under:',
    '',
    list,
    '',
    'When summarizing version-control status, reviewing diffs, or deciding what to commit, ignore those paths.',
    '',
    '## Commands and paths',
    '',
    '- Run shell commands from this workspace root as usual — paths like `src/` resolve to the real project.',
    '- Do **not** run `capa install`, `capa add`, or `capa clean` from this shadow workspace.',
    '- Never write skills, MCP config, rules, or hooks into the real project tree — only into the shadow provider paths above.',
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
