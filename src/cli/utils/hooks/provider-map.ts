import type { HooksIntegration, ProviderEventMapping } from '../../../types/providers';
import type { CanonicalHookEvent, Hook } from '../../../types/hooks';

/**
 * Returns the list of provider ids targeted by this hook's `providers` field
 * (or null when the provider is not targeted). Returns an array for parity
 * with possible future expansion (e.g. wildcards).
 */
export function scopeHookForProvider(hook: Hook, providerId: string): string[] | null {
  if (!hook.providers || hook.providers.length === 0) return [providerId];
  return hook.providers.includes(providerId) ? [providerId] : null;
}

export function pickMapping(integration: HooksIntegration, on: string, providerId: string): ProviderEventMapping | null {
  const colonIdx = on.indexOf(':');
  if (colonIdx > 0) {
    const prefix = on.slice(0, colonIdx);
    if (prefix.toLowerCase() !== providerId.toLowerCase()) return null;
    return { event: on.slice(colonIdx + 1) };
  }
  const canonical = on as CanonicalHookEvent;
  return integration.eventMap[canonical] ?? null;
}

export function resolveProviderEventName(
  integration: HooksIntegration,
  hook: Hook,
  providerId: string,
): string | null {
  const m = pickMapping(integration, hook.on, providerId);
  return m ? m.event : null;
}
