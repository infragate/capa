/**
 * Parse `capa sh …` invocations from provider shell hooks and match them to
 * qualified MCP tool names (`server.tool_name`) via the same kebab-case rules
 * as the shell CLI.
 */

import { slugify } from "./slug";

const CAPA_SH_RE = /\bcapa\s+sh\b/i;

export function capaShSegmentsFromQualifiedToolName(qualified: string): string[] {
	return qualified
		.trim()
		.split(".")
		.map((part) => slugify(part.trim()))
		.filter(Boolean);
}

/** True when parsed `capa sh` argv segments name the same tool as `qualified`. */
export function capaShSegmentsMatchQualifiedTool(
	segments: readonly string[],
	qualified: string,
): boolean {
	const expected = capaShSegmentsFromQualifiedToolName(qualified);
	if (segments.length !== expected.length) return false;
	return segments.every((seg, i) => seg === expected[i]);
}

/**
 * Tokenize argv after `capa sh` until `--flags`, shell operators, or junk.
 * Works on full shell lines (`cd … && capa sh server tool …`).
 */
export function parseCapaShSegmentsFromShellText(text: string): string[] | null {
	const match = CAPA_SH_RE.exec(text);
	if (!match) return null;

	let rest = text.slice(match.index + match[0].length);
	const segments: string[] = [];

	while (rest.length > 0) {
		rest = rest.trimStart();
		if (!rest || rest.startsWith("--")) break;
		// Stop before shell redirections / operators (`2>/dev/null`, `>`, `|`, …).
		if (/^(?:\d*>|&>|>&|>>|<|[|;&])/.test(rest)) break;

		const token = /^([a-z0-9][\w-]*)/i.exec(rest);
		if (!token) break;

		segments.push(token[1].toLowerCase());
		rest = rest.slice(token[1].length);
	}

	return segments.length > 0 ? segments : null;
}

function shellCommandFromArgsJson(
	argsJson: string | null | undefined,
): string | null {
	if (!argsJson?.trim()) return null;
	try {
		const parsed = JSON.parse(argsJson) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		const command = (parsed as { command?: unknown }).command;
		return typeof command === "string" ? command : null;
	} catch {
		return null;
	}
}

/** Parsed `capa sh` segments from a provider afterShell row. */
export function capaShSegmentsFromHookRow(row: {
	tool_name: string;
	args_json?: string | null;
}): string[] | null {
	let text = row.tool_name;
	if (!CAPA_SH_RE.test(text)) {
		const cmd = shellCommandFromArgsJson(row.args_json);
		if (!cmd || !CAPA_SH_RE.test(cmd)) return null;
		text = cmd;
	}
	return parseCapaShSegmentsFromShellText(text);
}

export function hookRowLooksLikeCapaSh(row: {
	tool_name: string;
	args_json?: string | null;
}): boolean {
	return capaShSegmentsFromHookRow(row) != null;
}
