import { prompt, isInteractive, type SelectOption } from '../ui';
import {
  formatWrappableProviderList,
  getWrappableProviders,
  resolveWrapTarget,
} from '../../shared/providers';
import type { ProviderIntegration } from '../../types/providers';

/**
 * Build select options for `capa wrap`: one entry per wrappable provider id,
 * plus each `wrap.aliases` token (e.g. Cursor GUI + `agent` CLI).
 */
export function buildWrapSelectOptions(
  providers: ProviderIntegration[] = getWrappableProviders(),
): SelectOption[] {
  const options: SelectOption[] = [];

  for (const p of providers) {
    if (!p.wrap) continue;
    options.push({
      value: p.id,
      label: p.displayName,
      hint: p.wrap.binary,
    });
    for (const [alias, launch] of Object.entries(p.wrap.aliases ?? {})) {
      if (alias.toLowerCase() === p.id.toLowerCase()) continue;
      options.push({
        value: alias,
        label: `${p.displayName} (${alias})`,
        hint: launch.binary,
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

async function detectInstalledWrappableIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const p of getWrappableProviders()) {
    if (!p.detectInstalled) continue;
    try {
      if (await p.detectInstalled()) ids.add(p.id);
    } catch {
      // ignore detection failures
    }
  }
  return ids;
}

/**
 * Resolve the wrap provider token: use the CLI arg when present, otherwise
 * prompt interactively (TTY) among wrappable providers — same pattern as
 * `capa install` when no provider is configured.
 */
export async function resolveWrapProviderArg(
  providerArg: string | undefined,
): Promise<string> {
  if (providerArg?.trim()) return providerArg.trim();

  const allOptions = buildWrapSelectOptions();
  if (allOptions.length === 0) {
    throw new Error('No wrappable providers are registered.');
  }

  if (!isInteractive()) {
    throw new Error(
      `Missing provider. Wrappable providers: ${formatWrappableProviderList() || '(none)'}\n` +
        '  Pass a provider, e.g. capa wrap cursor',
    );
  }

  const detectedIds = await detectInstalledWrappableIds();
  const preferred =
    detectedIds.size > 0
      ? allOptions.filter((o) => {
          const target = resolveWrapTarget(o.value);
          return target != null && detectedIds.has(target.provider.id);
        })
      : allOptions;

  return prompt.select(
    'Which provider do you want to wrap?',
    preferred.length > 0 ? preferred : allOptions,
    '<provider>',
  );
}
