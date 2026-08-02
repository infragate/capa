import type { HooksIntegration, ProviderEventMapping } from '../../../types/providers';
import {
  CANONICAL_HOOK_EVENTS,
  type CanonicalHookEvent,
  type Hook,
  type ProviderScopedEvent,
} from '../../../types/hooks';
import { getProvider } from '../../../shared/providers';

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

function matcherMatchesPrefix(matcher: string, prefix: string): boolean {
  if (prefix.endsWith('__')) {
    return matcher.startsWith(prefix) || matcher.includes(prefix);
  }
  const alts = prefix.split('|').map((a) => a.trim()).filter(Boolean);
  const parts = matcher.split('|').map((a) => a.trim()).filter(Boolean);
  return alts.some((a) => parts.includes(a) || matcher === a);
}

/**
 * Map a provider-native hook event (e.g. Claude `SessionStart`, Cursor
 * `sessionStart`) onto capa's canonical event when `eventMap` has a match.
 * Falls back to `<provider>:<event>` only when there is no canonical mapping
 * (same rule as bootstrap discovery).
 */
export function toCanonicalOrScopedHookOn(
  providerId: string,
  nativeEvent: string,
  matcher?: string,
): CanonicalHookEvent | ProviderScopedEvent {
  if ((CANONICAL_HOOK_EVENTS as readonly string[]).includes(nativeEvent)) {
    return nativeEvent as CanonicalHookEvent;
  }

  const integration = getProvider(providerId)?.hooks;
  if (!integration) {
    return `${providerId}:${nativeEvent}`;
  }

  let best: CanonicalHookEvent | null = null;
  let bestScore = -1;
  for (const [canonical, mapping] of Object.entries(integration.eventMap) as [
    CanonicalHookEvent,
    ProviderEventMapping | undefined,
  ][]) {
    if (!mapping || mapping.event !== nativeEvent) continue;
    if ('matcherPrefix' in mapping && mapping.matcherPrefix) {
      if (!matcher || !matcherMatchesPrefix(matcher, mapping.matcherPrefix)) {
        continue;
      }
      if (2 > bestScore) {
        best = canonical;
        bestScore = 2;
      }
    } else if (1 > bestScore) {
      best = canonical;
      bestScore = 1;
    }
  }

  return best ?? `${providerId}:${nativeEvent}`;
}
