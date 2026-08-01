import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { UnifiedHookEntry } from "../../types/plugin";
import { isPlainObject } from "./types-helpers";

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function loadHooksObject(
	repoRoot: string,
	raw: unknown,
): Record<string, unknown> | null {
	if (isPlainObject(raw)) {
		// Inline: { hooks: { Event: [...] } } or bare { Event: [...] }
		if (isPlainObject(raw.hooks)) return raw.hooks as Record<string, unknown>;
		return raw;
	}
	if (typeof raw === "string") {
		const rel = raw.replace(/^\.\//, "");
		const abs = join(repoRoot, rel);
		if (!existsSync(abs)) return null;
		try {
			const data = JSON.parse(readFileSync(abs, "utf-8"));
			if (isPlainObject(data?.hooks)) return data.hooks as Record<string, unknown>;
			if (isPlainObject(data)) return data;
		} catch {
			return null;
		}
	}
	return null;
}

function parseHookAction(
	event: string,
	action: unknown,
	index: number,
	matcher?: string,
): UnifiedHookEntry | null {
	if (!isPlainObject(action)) return null;
	const typeRaw = action.type;
	const type: "command" | "prompt" =
		typeRaw === "prompt" ? "prompt" : "command";

	const command =
		typeof action.command === "string" ? action.command : undefined;
	const prompt =
		typeof action.prompt === "string"
			? action.prompt
			: typeof action.text === "string"
				? action.text
				: undefined;

	if (type === "command" && !command) return null;
	if (type === "prompt" && !prompt) return null;

	const name =
		typeof action.name === "string" && action.name.length > 0
			? action.name
			: undefined;
	const idHint = name
		? slugify(name)
		: `${slugify(event) || "hook"}-${index}`;

	const timeout =
		typeof action.timeout === "number" && action.timeout > 0
			? action.timeout
			: undefined;
	const failClosed =
		typeof action.failClosed === "boolean"
			? action.failClosed
			: typeof action.fail_closed === "boolean"
				? action.fail_closed
				: undefined;
	const sequential =
		typeof action.sequential === "boolean" ? action.sequential : undefined;

	return {
		idHint,
		event,
		type,
		command,
		prompt,
		matcher,
		timeout,
		failClosed,
		sequential,
	};
}

/**
 * Expand one event's matcher groups into UnifiedHookEntry list.
 * Claude shape: Event -> [{ matcher?, hooks: [{ type, command }] }]
 * Cursor may also use Event -> [{ command, ... }] directly.
 */
function expandEventHooks(
	event: string,
	groups: unknown,
): UnifiedHookEntry[] {
	if (!Array.isArray(groups)) return [];
	const out: UnifiedHookEntry[] = [];
	let actionIndex = 0;

	for (const group of groups) {
		if (!isPlainObject(group)) continue;
		const matcher =
			typeof group.matcher === "string"
				? group.matcher
				: typeof group.pattern === "string"
					? group.pattern
					: undefined;

		const nested = group.hooks;
		if (Array.isArray(nested)) {
			for (const action of nested) {
				const entry = parseHookAction(event, action, actionIndex++, matcher);
				if (entry) out.push(entry);
			}
			continue;
		}

		// Flat action on the group itself (Cursor-style)
		const entry = parseHookAction(event, group, actionIndex++, matcher);
		if (entry) out.push(entry);
	}
	return out;
}

/**
 * Parse hooks from the manifest `hooks` field (path or inline object) and/or
 * the default `hooks/hooks.json` when the field is omitted.
 *
 * Cursor manifests typically set `hooks: "./hooks/hooks-cursor.json"`.
 * Claude manifests omit the field and rely on `hooks/hooks.json`.
 */
export function parseHookEntries(
	repoRoot: string,
	record: Record<string, unknown>,
): UnifiedHookEntry[] {
	const fromManifest = record.hooks;
	let hooksObj: Record<string, unknown> | null = null;

	if (fromManifest !== undefined && fromManifest !== null) {
		if (Array.isArray(fromManifest)) {
			for (const item of fromManifest) {
				const part = loadHooksObject(repoRoot, item);
				if (part) {
					hooksObj = { ...(hooksObj ?? {}), ...part };
				}
			}
		} else {
			hooksObj = loadHooksObject(repoRoot, fromManifest);
		}
	} else {
		hooksObj = loadHooksObject(repoRoot, "hooks/hooks.json");
	}

	if (!hooksObj) return [];

	const entries: UnifiedHookEntry[] = [];
	for (const [event, groups] of Object.entries(hooksObj)) {
		if (event === "description" || event === "version") continue;
		entries.push(...expandEventHooks(event, groups));
	}
	return entries;
}

export function discoverDefaultHooks(repoRoot: string): UnifiedHookEntry[] {
	return parseHookEntries(repoRoot, {});
}
