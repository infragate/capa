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
