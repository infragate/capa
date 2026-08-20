/**
 * Reconcile rows that share a `generation_id` but disagree on `conversation_id`.
 * Anchor kinds (`prompt`, `stop`) pick the canonical id; sibling spans in that
 * generation are rewritten when they belong to the same provider stream.
 */

export type ActivityCorrelationRow = {
	source: string | null;
	kind: string;
	conversation_id: string | null;
	generation_id: string | null;
	attributes_json?: string | null;
};

const TRANSCRIPT_CHAT_ID_RE = /agent-transcripts\/([^/]+)\//;

/** Provider sources that may share a generation with Cursor chat anchors. */
const CURSOR_STREAM_SOURCES = new Set(["cursor", "shell", "capa"]);

export function chatConversationIdFromTranscriptPath(
	path: string | null | undefined,
): string | null {
	if (!path?.trim()) return null;
	const match = TRANSCRIPT_CHAT_ID_RE.exec(path.replace(/\\/g, "/"));
	const id = match?.[1]?.trim();
	return id || null;
}

function parseAttributesJson(
	json: string | null | undefined,
): Record<string, unknown> | null {
	if (!json?.trim()) return null;
	try {
		const value = JSON.parse(json) as unknown;
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function transcriptPathFromRow(row: ActivityCorrelationRow): string | null {
	const raw = row.attributes_json;
	if (!raw?.trim() || !raw.includes("transcript_path")) return null;
	const attrs = parseAttributesJson(raw);
	const path = attrs?.transcript_path;
	return typeof path === "string" ? path : null;
}

function normalizeSource(source: string | null | undefined): string | null {
	const trimmed = source?.trim().toLowerCase();
	return trimmed || null;
}

function anchorConversationId(row: ActivityCorrelationRow): string | null {
	if (row.kind === "prompt") return row.conversation_id?.trim() || null;
	if (row.kind === "stop") {
		return (
			row.conversation_id?.trim() ||
			chatConversationIdFromTranscriptPath(transcriptPathFromRow(row))
		);
	}
	return null;
}

function sharesAnchorStream(
	rowSource: string | null | undefined,
	anchorSources: ReadonlySet<string>,
): boolean {
	const src = normalizeSource(rowSource);
	if (!src || anchorSources.size === 0) return false;

	for (const anchor of anchorSources) {
		if (src === anchor) return true;
		if (
			CURSOR_STREAM_SOURCES.has(anchor) &&
			CURSOR_STREAM_SOURCES.has(src)
		) {
			return true;
		}
	}
	return false;
}

/** @deprecated Name kept for callers; logic is generation-scoped, not provider-specific. */
export function reconcileCursorActivityConversationIds<
	T extends ActivityCorrelationRow,
>(calls: readonly T[]): T[] {
	const canonicalByGeneration = new Map<string, string>();
	const anchorSourcesByGeneration = new Map<string, Set<string>>();
	const ambiguousGenerations = new Set<string>();

	for (const call of calls) {
		const generationId = call.generation_id?.trim();
		const anchorId = anchorConversationId(call);
		if (!generationId || !anchorId) continue;

		const anchorSource = normalizeSource(call.source);
		if (!anchorSource) continue;

		if (ambiguousGenerations.has(generationId)) continue;
		const existing = canonicalByGeneration.get(generationId);
		if (existing && existing !== anchorId) {
			canonicalByGeneration.delete(generationId);
			anchorSourcesByGeneration.delete(generationId);
			ambiguousGenerations.add(generationId);
			continue;
		}
		canonicalByGeneration.set(generationId, anchorId);
		const sources =
			anchorSourcesByGeneration.get(generationId) ?? new Set<string>();
		sources.add(anchorSource);
		anchorSourcesByGeneration.set(generationId, sources);
	}

	if (canonicalByGeneration.size === 0) return [...calls];

	return calls.map((call) => {
		const generationId = call.generation_id?.trim();
		if (!generationId || ambiguousGenerations.has(generationId)) return call;
		const canonical = canonicalByGeneration.get(generationId);
		const anchorSources = anchorSourcesByGeneration.get(generationId);
		if (
			!canonical ||
			!anchorSources ||
			!sharesAnchorStream(call.source, anchorSources)
		) {
			return call;
		}
		if (call.conversation_id === canonical) return call;
		return { ...call, conversation_id: canonical };
	});
}
