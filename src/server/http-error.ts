/**
 * Extract a single-line, client-safe error message.
 * Never forwards `Error.stack` (only `.message`, first line).
 */
export function clientErrorMessage(
	err: unknown,
	fallback = "Request failed",
): string {
	let raw = "";
	if (err instanceof Error) {
		raw = err.message;
	} else if (typeof err === "string" && err.trim()) {
		raw = err;
	} else if (
		err &&
		typeof err === "object" &&
		"message" in err &&
		typeof (err as { message: unknown }).message === "string"
	) {
		// Some runtimes throw Error-like objects that fail `instanceof Error`.
		raw = (err as { message: string }).message;
	} else {
		return fallback;
	}
	const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
	if (!firstLine) return fallback;
	return firstLine.length > 500 ? firstLine.slice(0, 500) : firstLine;
}
