/**
 * Extract a single-line, client-safe error message.
 * Never forwards `Error.stack` or multi-line exception dumps.
 */
export function clientErrorMessage(
	err: unknown,
	fallback = "Request failed",
): string {
	if (!(err instanceof Error)) return fallback;
	const firstLine = err.message.split("\n", 1)[0]?.trim() ?? "";
	if (!firstLine) return fallback;
	// Stack frames sometimes leak into message via wrapped errors.
	if (/\bat\s+\S+/.test(firstLine)) return fallback;
	return firstLine.length > 500 ? firstLine.slice(0, 500) : firstLine;
}
