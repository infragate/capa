/**
 * Field accessors for provider hook stdin payloads.
 * Shared by normalize + capa-MCP dedup so tool/prompt/command paths stay aligned.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

export function stringField(
	obj: Record<string, unknown>,
	key: string,
): string | null {
	const v = obj[key];
	return typeof v === "string" && v.trim() ? v : null;
}

export function nested(obj: Record<string, unknown>, path: string[]): unknown {
	let cur: unknown = obj;
	for (const key of path) {
		if (!cur || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

export function nestedString(
	obj: Record<string, unknown>,
	path: string[],
): string | null {
	const v = nested(obj, path);
	return typeof v === "string" && v.trim() ? v : null;
}

export function toolNameFrom(obj: Record<string, unknown>): string | null {
	return (
		stringField(obj, "tool_name") ||
		stringField(obj, "toolName") ||
		stringField(obj, "name") ||
		nestedString(obj, ["tool", "name"])
	);
}

export function promptTextFrom(obj: Record<string, unknown>): string | null {
	return (
		stringField(obj, "prompt") ||
		stringField(obj, "user_prompt") ||
		stringField(obj, "content") ||
		nestedString(obj, ["input", "prompt"])
	);
}

export function shellCommandFrom(obj: Record<string, unknown>): string | null {
	return (
		stringField(obj, "command") ||
		stringField(obj, "cmd") ||
		nestedString(obj, ["tool_input", "command"]) ||
		nestedString(obj, ["input", "command"]) ||
		nestedString(obj, ["args", "command"])
	);
}

export function extractPath(obj: Record<string, unknown>): string | null {
	return (
		stringField(obj, "file_path") ||
		stringField(obj, "filePath") ||
		stringField(obj, "path") ||
		nestedString(obj, ["tool_input", "file_path"]) ||
		nestedString(obj, ["tool_input", "path"]) ||
		nestedString(obj, ["input", "file_path"]) ||
		nestedString(obj, ["input", "path"]) ||
		null
	);
}

/** Model token usage from provider hooks (e.g. Cursor `stop`). */
export interface TokenUsage {
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cache_write_tokens: number | null;
}

function nonNegInt(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.floor(value);
	}
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n) && n >= 0) return Math.floor(n);
	}
	return null;
}

function pickToken(
	sources: Array<Record<string, unknown> | null | undefined>,
	keys: string[],
): number | null {
	for (const src of sources) {
		if (!src) continue;
		for (const key of keys) {
			const n = nonNegInt(src[key]);
			if (n != null) return n;
		}
	}
	return null;
}

/**
 * Pull input/output/cache token counts from a hook payload.
 * Supports Cursor stop fields and nested `usage` objects (Claude-style).
 */
export function tokenUsageFrom(obj: Record<string, unknown>): TokenUsage | null {
	const usage = asRecord(obj.usage) ?? asRecord(obj.token_usage);
	const sources = [obj, usage];

	const input_tokens = pickToken(sources, [
		"input_tokens",
		"inputTokens",
		"prompt_tokens",
		"promptTokens",
	]);
	const output_tokens = pickToken(sources, [
		"output_tokens",
		"outputTokens",
		"completion_tokens",
		"completionTokens",
	]);
	const cache_read_tokens = pickToken(sources, [
		"cache_read_tokens",
		"cacheReadTokens",
		"cache_read_input_tokens",
		"cache_read",
	]);
	const cache_write_tokens = pickToken(sources, [
		"cache_write_tokens",
		"cacheWriteTokens",
		"cache_creation_input_tokens",
		"cache_creation_tokens",
		"cache_write",
	]);

	if (
		input_tokens == null &&
		output_tokens == null &&
		cache_read_tokens == null &&
		cache_write_tokens == null
	) {
		return null;
	}

	return {
		input_tokens,
		output_tokens,
		cache_read_tokens,
		cache_write_tokens,
	};
}

