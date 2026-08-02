import type { Hook } from '../../../types/hooks';

/**
 * Normalize command/prompt text so Claude-quoted and Cursor-relative rewrites
 * of the same plugin script compare equal (quotes + path separators).
 */
export function normalizeHookBodyForDedupe(value: string | undefined): string {
  if (value == null) return '';
  return value.replace(/"/g, '').replace(/\\/g, '/').trim();
}

/** Identity for coalescing sibling Claude/Cursor plugin hooks into one entry. */
export function pluginHookMergeKey(hook: {
  on: string;
  type?: string;
  command?: string;
  prompt?: string;
}): string {
  return [
    hook.on,
    hook.type ?? 'command',
    normalizeHookBodyForDedupe(hook.command),
    normalizeHookBodyForDedupe(hook.prompt),
  ].join('\0');
}

/**
 * Sibling manifests often attach a provider-only matcher on one side
 * (e.g. Claude SessionStart `startup|clear|compact`) and omit it on the other.
 * Those are still the same hook. Distinct non-empty matchers stay separate.
 */
export function matchersCompatible(
  a: string | undefined,
  b: string | undefined,
): boolean {
  const ma = a?.trim() || '';
  const mb = b?.trim() || '';
  if (!ma || !mb) return true;
  return ma === mb;
}

/**
 * If an equivalent hook from the same plugin already exists, union providers.
 * When more than one provider declares the same body, drop `providers` so the
 * hook installs for all project providers (canonical cross-provider behavior).
 * Provider-specific matchers are cleared when they disagree across siblings.
 * Returns true when the new entry was absorbed.
 */
export function coalescePluginHook(
  mergedHooks: Hook[],
  pluginInstallId: string,
  candidate: Hook,
  targetProvider: string,
): boolean {
  const key = pluginHookMergeKey(candidate);
  const existing = mergedHooks.find(
    (h) =>
      h.sourcePlugin?.id === pluginInstallId &&
      pluginHookMergeKey(h) === key &&
      matchersCompatible(h.matcher, candidate.matcher),
  );
  if (!existing) return false;

  if (!existing.providers || existing.providers.length === 0) {
    if ((existing.matcher ?? '') !== (candidate.matcher ?? '')) {
      delete existing.matcher;
    }
    return true;
  }

  const providers = new Set(existing.providers);
  providers.add(targetProvider);
  if (providers.size > 1) {
    delete existing.providers;
    // Matcher from one provider (e.g. Claude SessionStart kinds) must not
    // become a Cursor `pattern` filter on the unified hook.
    if ((existing.matcher ?? '') !== (candidate.matcher ?? '')) {
      delete existing.matcher;
    }
  } else {
    existing.providers = [...providers];
  }
  return true;
}
