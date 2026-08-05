/**
 * Stable fingerprints for matching capa shell/MCP tool output to provider
 * afterShell hook payloads (same bytes the agent saw).
 */

import { createHash } from "node:crypto";

/** Max |Δstarted_at| when pairing capa traces with provider shell hooks. */
export const ACTIVITY_TRACE_LINK_WINDOW_MS = 5 * 60 * 1000;

/** Must match {@link TOOL_CALL_PREVIEW_MAX_CHARS} in tool-call-tracer. */
export const ACTIVITY_OUTPUT_FINGERPRINT_PREFIX_CHARS = 6_000;

export function normalizeActivityOutputText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function activityOutputToText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * SHA-256 hex of normalized tool/shell output for trace pairing.
 * Hashes only the first {@link ACTIVITY_OUTPUT_FINGERPRINT_PREFIX_CHARS} so capa
 * MCP traces match provider afterShell hooks when tails differ past the preview cap.
 */
export function fingerprintActivityOutput(value: unknown): string {
	const normalized = normalizeActivityOutputText(activityOutputToText(value));
	const prefix =
		normalized.length <= ACTIVITY_OUTPUT_FINGERPRINT_PREFIX_CHARS
			? normalized
			: normalized.slice(0, ACTIVITY_OUTPUT_FINGERPRINT_PREFIX_CHARS);
	return createHash("sha256").update(prefix, "utf8").digest("hex");
}

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
