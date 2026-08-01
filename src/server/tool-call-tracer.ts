import { nanoid } from "nanoid";
import type { CapaDatabase } from "../db/database";
import type {
	ToolCallKind,
	ToolCallRecord,
	ToolCallStatus,
} from "../types/database";

export const TOOL_CALL_PREVIEW_MAX_CHARS = 6_000;

export type ToolCallNotify = (
	projectId: string,
	record: ToolCallRecord,
) => void;

export interface ToolCallStartInput {
	projectId: string;
	sessionId?: string | null;
	agentId?: string | null;
	source?: string | null;
	kind: ToolCallKind;
	toolName: string;
	metaTool?: string | null;
	args?: unknown;
}

export interface ToolCallFinishInput {
	status: Exclude<ToolCallStatus, "running">;
	resultPreview?: unknown;
	errorMessage?: string | null;
}

/**
 * Persist + broadcast tool-call activity for the project page live feed.
 * Args/results are truncated and optionally redacted against project variables.
 * Size/token stats are measured on the original (pre-truncate) result text.
 */
export class ToolCallTracer {
	constructor(
		private db: CapaDatabase,
		private notify?: ToolCallNotify,
	) {}

	start(input: ToolCallStartInput): string {
		const id = nanoid();
		const secrets = this.secretValues(input.projectId);
		const record = this.db.insertToolCall({
			id,
			project_id: input.projectId,
			session_id: input.sessionId ?? null,
			started_at: Date.now(),
			duration_ms: null,
			status: "running",
			source: input.source ?? null,
			kind: input.kind,
			tool_name: input.toolName,
			meta_tool: input.metaTool ?? null,
			args_json: serializeForPreview(input.args, secrets),
			result_preview: null,
			result_bytes: null,
			result_tokens: null,
			error_message: null,
			agent_id: input.agentId ?? null,
		});
		this.notify?.(input.projectId, record);
		return id;
	}

	finish(id: string, input: ToolCallFinishInput): ToolCallRecord | null {
		const existing = this.db.getToolCall(id);
		if (!existing) return null;

		const secrets = this.secretValues(existing.project_id);
		const durationMs = Math.max(0, Date.now() - existing.started_at);

		let resultPreview = existing.result_preview;
		let resultBytes = existing.result_bytes;
		let resultTokens = existing.result_tokens;

		if (input.resultPreview !== undefined) {
			const sized = serializeResultWithSize(input.resultPreview, secrets);
			resultPreview = sized.preview;
			resultBytes = sized.bytes;
			resultTokens = sized.tokens;
		}

		const errorMessage =
			input.errorMessage == null
				? null
				: truncateText(redactText(String(input.errorMessage), secrets));

		const record = this.db.finishToolCall(id, {
			status: input.status,
			duration_ms: durationMs,
			result_preview: resultPreview,
			result_bytes: resultBytes,
			result_tokens: resultTokens,
			error_message: errorMessage,
		});
		if (record) this.notify?.(record.project_id, record);
		return record;
	}

	private secretValues(projectId: string): string[] {
		const vars = this.db.getAllVariables(projectId);
		return Object.values(vars).filter((v) => v.length >= 8);
	}
}

/** Map MCP clientInfo.name to a stable activity source label. */
export function resolveToolCallSource(
	clientName: string | null | undefined,
): string {
	if (clientName === "capa-shell") return "shell";
	if (clientName && clientName.trim()) return clientName.trim();
	return "mcp";
}

/** Serialize value to text without truncating (used for size measurement). */
export function valueToText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** ~4 chars ≈ 1 token — same heuristic as token savings estimates. */
export function estimateTokensFromText(text: string): number {
	return Math.ceil(text.length / 4);
}

export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

/**
 * Measure original result size, then redact + truncate for storage/display.
 */
export function serializeResultWithSize(
	value: unknown,
	secrets: string[] = [],
	maxChars = TOOL_CALL_PREVIEW_MAX_CHARS,
): { preview: string | null; bytes: number | null; tokens: number | null } {
	if (value === undefined || value === null) {
		return { preview: null, bytes: null, tokens: null };
	}
	const original = valueToText(value);
	return {
		preview: truncateText(redactText(original, secrets), maxChars),
		bytes: utf8ByteLength(original),
		tokens: estimateTokensFromText(original),
	};
}

export function serializeForPreview(
	value: unknown,
	secrets: string[] = [],
	maxChars = TOOL_CALL_PREVIEW_MAX_CHARS,
): string | null {
	if (value === undefined || value === null) return null;
	return truncateText(redactText(valueToText(value), secrets), maxChars);
}

export function redactText(text: string, secrets: string[]): string {
	let out = text;
	for (const secret of secrets) {
		if (!secret) continue;
		out = out.split(secret).join("[REDACTED]");
	}
	return out;
}

export function truncateText(
	text: string,
	maxChars = TOOL_CALL_PREVIEW_MAX_CHARS,
): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

/** Pull a human-readable preview from an MCP tool-call result payload. */
export function previewFromToolResult(result: unknown): string | null {
	if (result == null) return null;
	if (typeof result === "string") return result;

	const asRecord = result as Record<string, unknown>;
	const content = asRecord?.content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const item of content) {
			if (!item || typeof item !== "object") continue;
			const block = item as { type?: string; text?: string };
			if (typeof block.text === "string") parts.push(block.text);
		}
		if (parts.length > 0) return parts.join("\n");
	}

	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}
