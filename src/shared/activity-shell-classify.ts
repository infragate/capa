/**
 * Classify activity rows used when pairing capa shell traces with provider
 * afterShell hooks (command + time window matching).
 */

/** Max |Δstarted_at| when pairing capa traces with provider shell hooks. */
export const ACTIVITY_TRACE_LINK_WINDOW_MS = 5 * 60 * 1000;

const CAPA_SH_RE = /\bcapa\s+sh\b/i;

/** True for traces emitted by capa's own shell client (`source: shell`). */
export function isCapaShellActivitySource(source: string | null | undefined): boolean {
	return source === "shell";
}

/** Provider afterShell row (not capa's own shell/MCP tracer). */
export function isProviderShellHookRow(row: {
	kind: string;
	source: string | null;
}): boolean {
	if (row.kind !== "shell") return false;
	if (!row.source || row.source === "shell" || row.source === "mcp") return false;
	return true;
}

/**
 * Provider shell span that wrapped a `capa sh …` invocation (Cursor puts the
 * command in `tool_name`; Claude may nest under args).
 */
export function providerShellLooksLikeCapaSh(row: {
	tool_name: string;
	args_json?: string | null;
}): boolean {
	if (CAPA_SH_RE.test(row.tool_name)) return true;
	const cmd = shellCommandFromArgsJson(row.args_json);
	return cmd != null && CAPA_SH_RE.test(cmd);
}

function shellCommandFromArgsJson(argsJson: string | null | undefined): string | null {
	if (!argsJson?.trim()) return null;
	try {
		const parsed = JSON.parse(argsJson) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const command = (parsed as { command?: unknown }).command;
		return typeof command === "string" ? command : null;
	} catch {
		return null;
	}
}

export function activityTraceLinkTimeBounds(
	centerStartedAt: number,
	windowMs = ACTIVITY_TRACE_LINK_WINDOW_MS,
): { since: number; until: number } {
	return {
		since: centerStartedAt - windowMs,
		until: centerStartedAt + windowMs,
	};
}
