/**
 * Shared allow-list for capability entry ids that become on-disk filenames
 * (skills, rules, sub-agents, hooks, plugin skill entries).
 *
 * Keeps install destinations as a single path segment under the provider
 * directory so ids cannot walk out via `..` or separators.
 */

const SAFE_CAPABILITY_ID_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62})$/;

/**
 * Returns true when `id` is a single safe path segment suitable for joining
 * under a provider skills/rules/agents/hooks directory.
 */
export function isSafeCapabilityId(id: string): boolean {
	if (!SAFE_CAPABILITY_ID_RE.test(id)) return false;
	if (id.includes("..")) return false;
	if (id.includes("/") || id.includes("\\")) return false;
	return true;
}

/** Same allow-list; retained for existing hook call sites. */
export function isSafeHookId(id: string): boolean {
	return isSafeCapabilityId(id);
}

export function describeUnsafeCapabilityId(kind: string, id: string): string {
	return (
		`${kind} id "${id}" is not allowed for install paths; ` +
		`use [a-zA-Z0-9._-], start with alphanumeric, max 63 chars, no '..', '/', or '\\'`
	);
}
