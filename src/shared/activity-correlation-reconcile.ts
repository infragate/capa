/**
 * Reconcile provider activity rows whose conversation_id disagrees within the
 * same generation (Cursor Agent CLI sends chat id on prompts and a separate
 * agent-session id on tool/shell hooks).
 */

export type ActivityCorrelationRow = {
	source: string | null;
	kind: string;
	conversation_id: string | null;
	generation_id: string | null;
	attributes_json?: string | null;
};

const TRANSCRIPT_CHAT_ID_RE = /agent-transcripts\/([^/]+)\//;

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

/**
 * Rewrite `conversation_id` on Cursor rows so a generation's prompt, tools,
 * and stops share the composer/chat id used in transcript paths.
 */
export function reconcileCursorActivityConversationIds<
	T extends ActivityCorrelationRow,
>(calls: readonly T[]): T[] {
	const chatByGeneration = new Map<string, string>();
	const ambiguousGenerations = new Set<string>();
	const chatByAgentSession = new Map<string, string>();

	const noteChatForGeneration = (generationId: string, chatId: string) => {
		if (ambiguousGenerations.has(generationId)) return;
		const existing = chatByGeneration.get(generationId);
		if (existing && existing !== chatId) {
			chatByGeneration.delete(generationId);
			ambiguousGenerations.add(generationId);
			return;
		}
		chatByGeneration.set(generationId, chatId);
	};

	for (const call of calls) {
		if (call.source !== "cursor") continue;
		const generationId = call.generation_id?.trim();
		if (!generationId) continue;

		let chatId: string | null = null;
		if (call.kind === "prompt" && call.conversation_id?.trim()) {
			chatId = call.conversation_id.trim();
		}
		if (!chatId && call.kind === "stop") {
			chatId = chatConversationIdFromTranscriptPath(
				transcriptPathFromRow(call),
			);
		}
		if (chatId) noteChatForGeneration(generationId, chatId);
	}

	if (chatByGeneration.size === 0) return [...calls];

	const reconciled = calls.map((call) => {
		if (call.source !== "cursor") return call;
		const generationId = call.generation_id?.trim();
		if (!generationId || ambiguousGenerations.has(generationId)) return call;
		const chatId = chatByGeneration.get(generationId);
		if (!chatId || call.conversation_id === chatId) return call;
		const priorSession = call.conversation_id?.trim();
		if (priorSession) chatByAgentSession.set(priorSession, chatId);
		return { ...call, conversation_id: chatId };
	});

	if (chatByAgentSession.size === 0) return reconciled;

	return reconciled.map((call) => {
		const sessionId = call.conversation_id?.trim();
		if (!sessionId) return call;
		const chatId = chatByAgentSession.get(sessionId);
		if (!chatId || sessionId === chatId) return call;
		return { ...call, conversation_id: chatId };
	});
}
