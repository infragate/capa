/**
 * Named path matcher backed by Bun's URLPattern (no router dependency).
 * Patterns: `/api/projects/:id`, multi-segment tails via `:item+`.
 */
export function matchRoute(
	path: string,
	pattern: string,
): Record<string, string> | null {
	const m = new URLPattern({ pathname: pattern }).exec({ pathname: path });
	if (!m) return null;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(m.pathname.groups)) {
		if (v != null) out[k] = decodeURIComponent(v);
	}
	return out;
}
