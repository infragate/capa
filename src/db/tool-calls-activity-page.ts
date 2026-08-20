import type { Database } from "bun:sqlite";
import type { ToolCallRecord } from "../types/database";
import type { ToolCallListOptions, ToolCallListResult } from "./tool-calls";

/** Keep in sync with TOOL_CALLS_PAGE_SIZE_* in tool-calls.ts */
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;

type ActivityPageUnit = {
	unitKey: string;
	kind: "conversation" | "orphan";
	maxStarted: number;
	traceCount: number;
};

function compareActivityUnitsDesc(
	a: ActivityPageUnit,
	b: ActivityPageUnit,
): number {
	if (b.maxStarted !== a.maxStarted) return b.maxStarted - a.maxStarted;
	return b.unitKey.localeCompare(a.unitKey);
}

function isActivityUnitBeforeCursor(
	unit: ActivityPageUnit,
	cursor: { maxStarted: number; unitKey: string },
): boolean {
	if (unit.maxStarted !== cursor.maxStarted) {
		return unit.maxStarted < cursor.maxStarted;
	}
	return unit.unitKey.localeCompare(cursor.unitKey) < 0;
}

function getToolCall(db: Database, id: string): ToolCallRecord | null {
	return db
		.query("SELECT * FROM tool_calls WHERE id = ?")
		.get(id) as ToolCallRecord | null;
}

function countToolCalls(db: Database, projectId: string): number {
	const row = db
		.query("SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ?")
		.get(projectId) as { n: number };
	return row.n;
}

function countToolCallsForSession(
	db: Database,
	projectId: string,
	sessionId: string,
): number {
	const row = db
		.query(
			"SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ? AND session_id = ?",
		)
		.get(projectId, sessionId) as { n: number };
	return row.n;
}

/**
 * All traces for a provider conversation, including Cursor rows stored under
 * an agent-session conversation_id that share a generation with the chat id.
 */
function listToolCallsForConversation(
	db: Database,
	projectId: string,
	conversationId: string,
): ToolCallRecord[] {
	const chatId = conversationId.trim();
	const transcriptNeedle = `%agent-transcripts/${chatId}/%`;

	const seedRows = db
		.query(
			`SELECT * FROM tool_calls
         WHERE project_id = ?
           AND (
             conversation_id = ?
             OR (attributes_json IS NOT NULL AND attributes_json LIKE ?)
           )`,
		)
		.all(projectId, chatId, transcriptNeedle) as ToolCallRecord[];

	const allowedConversationIds = new Set<string>([chatId]);
	const generationIds = new Set<string>();
	for (const row of seedRows) {
		const gen = row.generation_id?.trim();
		if (gen) generationIds.add(gen);
	}

	for (const genId of generationIds) {
		const genRows = db
			.query(
				`SELECT * FROM tool_calls WHERE project_id = ? AND generation_id = ?`,
			)
			.all(projectId, genId) as ToolCallRecord[];

		const promptConvIds = new Set<string>();
		for (const row of genRows) {
			if (row.kind === "prompt" && row.conversation_id?.trim()) {
				promptConvIds.add(row.conversation_id.trim());
			}
		}
		if (promptConvIds.size > 1) continue;

		if (!genRows.some((row) => row.conversation_id?.trim() === chatId)) {
			continue;
		}

		for (const row of genRows) {
			const cid = row.conversation_id?.trim();
			if (!cid || cid === chatId || allowedConversationIds.has(cid)) continue;

			// Do not pull tool rows stored under another chat conversation id
			// that owns prompts elsewhere, even when generation_id collides.
			const ownsPromptElsewhere = db
				.query(
					`SELECT 1 FROM tool_calls
             WHERE project_id = ? AND conversation_id = ? AND kind = 'prompt'
             LIMIT 1`,
				)
				.get(projectId, cid);
			if (ownsPromptElsewhere) continue;

			allowedConversationIds.add(cid);
		}
	}

	if (allowedConversationIds.size === 1 && seedRows.length === 0) {
		return [];
	}

	const placeholders = [...allowedConversationIds].map(() => "?").join(", ");
	return db
		.query(
			`SELECT * FROM tool_calls
         WHERE project_id = ?
           AND conversation_id IN (${placeholders})
         ORDER BY started_at DESC, id DESC`,
		)
		.all(projectId, ...allowedConversationIds) as ToolCallRecord[];
}

function listActivityPageUnits(
	db: Database,
	projectId: string,
	cursor?: { maxStarted: number; unitKey: string } | null,
): ActivityPageUnit[] {
	const conversationRows = db
		.query(
			`SELECT conversation_id AS unit_key, MAX(started_at) AS max_started, COUNT(*) AS trace_count
         FROM tool_calls
         WHERE project_id = ? AND conversation_id IS NOT NULL
         GROUP BY conversation_id`,
		)
		.all(projectId) as Array<{
		unit_key: string;
		max_started: number;
		trace_count: number;
	}>;

	const orphanRows = db
		.query(
			`SELECT COALESCE(generation_id, id) AS unit_key, MAX(started_at) AS max_started, COUNT(*) AS trace_count
         FROM tool_calls
         WHERE project_id = ? AND conversation_id IS NULL
         GROUP BY COALESCE(generation_id, id)`,
		)
		.all(projectId) as Array<{
		unit_key: string;
		max_started: number;
		trace_count: number;
	}>;

	let units: ActivityPageUnit[] = [
		...conversationRows.map((row) => ({
			unitKey: row.unit_key,
			kind: "conversation" as const,
			maxStarted: Number(row.max_started),
			traceCount: Number(row.trace_count),
		})),
		...orphanRows.map((row) => ({
			unitKey: row.unit_key,
			kind: "orphan" as const,
			maxStarted: Number(row.max_started),
			traceCount: Number(row.trace_count),
		})),
	];

	units.sort(compareActivityUnitsDesc);

	if (cursor) {
		units = units.filter((unit) => isActivityUnitBeforeCursor(unit, cursor));
	}

	return units;
}

function resolveActivityPageCursor(
	db: Database,
	projectId: string,
	beforeStartedAt: number,
	beforeId: string,
): { maxStarted: number; unitKey: string } {
	const row = getToolCall(db, beforeId);
	if (!row || row.project_id !== projectId) {
		return { maxStarted: beforeStartedAt, unitKey: "" };
	}

	if (row.conversation_id) {
		const summary = db
			.query(
				`SELECT MAX(started_at) AS max_started FROM tool_calls
           WHERE project_id = ? AND conversation_id = ?`,
			)
			.get(projectId, row.conversation_id) as { max_started: number };
		return {
			maxStarted: Number(summary.max_started),
			unitKey: row.conversation_id,
		};
	}

	const orphanKey = row.generation_id ?? row.id;
	const summary = db
		.query(
			`SELECT MAX(started_at) AS max_started FROM tool_calls
         WHERE project_id = ? AND conversation_id IS NULL
           AND (generation_id = ? OR (generation_id IS NULL AND id = ?))`,
		)
		.get(projectId, orphanKey, orphanKey) as { max_started: number } | null;

	return {
		maxStarted: summary ? Number(summary.max_started) : beforeStartedAt,
		unitKey: orphanKey,
	};
}

function selectUnitsByTraceBudget(
	units: ActivityPageUnit[],
	traceBudget: number,
): ActivityPageUnit[] {
	const selected: ActivityPageUnit[] = [];
	let accumulated = 0;

	for (const unit of units) {
		if (selected.length === 0) {
			selected.push(unit);
			accumulated += unit.traceCount;
			if (unit.traceCount > traceBudget) break;
			continue;
		}
		if (accumulated + unit.traceCount > traceBudget) break;
		selected.push(unit);
		accumulated += unit.traceCount;
	}

	return selected;
}

function fetchTracesForActivityUnits(
	db: Database,
	projectId: string,
	units: ActivityPageUnit[],
): ToolCallRecord[] {
	const calls: ToolCallRecord[] = [];
	for (const unit of units) {
		if (unit.kind === "conversation") {
			const rows = db
				.query(
					`SELECT * FROM tool_calls
             WHERE project_id = ? AND conversation_id = ?
             ORDER BY started_at DESC, id DESC`,
				)
				.all(projectId, unit.unitKey) as ToolCallRecord[];
			calls.push(...rows);
		} else {
			const rows = db
				.query(
					`SELECT * FROM tool_calls
             WHERE project_id = ? AND conversation_id IS NULL
               AND (generation_id = ? OR (generation_id IS NULL AND id = ?))
             ORDER BY started_at DESC, id DESC`,
				)
				.all(projectId, unit.unitKey, unit.unitKey) as ToolCallRecord[];
			calls.push(...rows);
		}
	}

	calls.sort((a, b) => {
		if (b.started_at !== a.started_at) return b.started_at - a.started_at;
		return b.id.localeCompare(a.id);
	});
	return calls;
}

/**
 * Paginate activity by full conversations (or orphan run units), packing
 * units until the trace budget is reached. A single unit larger than the
 * budget is returned alone.
 */
function listRecentByActivityUnits(
	db: Database,
	projectId: string,
	traceBudget: number,
	beforeStartedAt: number | null,
	beforeId: string | null,
): ToolCallListResult {
	const cursor =
		beforeStartedAt != null && beforeId
			? resolveActivityPageCursor(db, projectId, beforeStartedAt, beforeId)
			: beforeStartedAt != null
				? { maxStarted: beforeStartedAt, unitKey: "" }
				: null;

	const units = listActivityPageUnits(db, projectId, cursor);
	const selected = selectUnitsByTraceBudget(units, traceBudget);
	const calls = fetchTracesForActivityUnits(db, projectId, selected);

	return {
		calls,
		total: countToolCalls(db, projectId),
		hasMore: selected.length < units.length,
	};
}

/** Activity / session / conversation / generation listing for tool_calls. */
export function listRecentToolCalls(
	db: Database,
	projectId: string,
	options: ToolCallListOptions = {},
): ToolCallListResult {
	const traceBudget = Math.max(
		1,
		Math.min(options.limit ?? PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX),
	);
	const beforeStartedAt = options.beforeStartedAt ?? options.before ?? null;
	const beforeId = options.beforeId ?? null;
	const sessionId = options.sessionId?.trim() || null;
	const conversationId = options.conversationId?.trim() || null;
	const generationId = options.generationId?.trim() || null;

	if (generationId) {
		const fetched = db
			.query(
				`SELECT * FROM tool_calls
           WHERE project_id = ? AND generation_id = ?
           ORDER BY started_at ASC, id ASC`,
			)
			.all(projectId, generationId) as ToolCallRecord[];

		return {
			calls: fetched,
			total: fetched.length,
			hasMore: false,
		};
	}

	if (sessionId) {
		let fetched: ToolCallRecord[];
		if (beforeStartedAt != null && beforeId) {
			fetched = db
				.query(
					`SELECT * FROM tool_calls
           WHERE project_id = ? AND session_id = ?
             AND (started_at < ? OR (started_at = ? AND id < ?))
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
				)
				.all(
					projectId,
					sessionId,
					beforeStartedAt,
					beforeStartedAt,
					beforeId,
					traceBudget + 1,
				) as ToolCallRecord[];
		} else if (beforeStartedAt != null) {
			fetched = db
				.query(
					`SELECT * FROM tool_calls
           WHERE project_id = ? AND session_id = ?
             AND started_at < ?
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
				)
				.all(
					projectId,
					sessionId,
					beforeStartedAt,
					traceBudget + 1,
				) as ToolCallRecord[];
		} else {
			fetched = db
				.query(
					`SELECT * FROM tool_calls
           WHERE project_id = ? AND session_id = ?
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
				)
				.all(projectId, sessionId, traceBudget + 1) as ToolCallRecord[];
		}

		const overflow = fetched.length > traceBudget;
		if (overflow) fetched.pop();

		return {
			calls: fetched,
			total: countToolCallsForSession(db, projectId, sessionId),
			hasMore: overflow,
		};
	}

	if (conversationId) {
		const fetched = listToolCallsForConversation(db, projectId, conversationId);

		return {
			calls: fetched,
			total: fetched.length,
			hasMore: false,
		};
	}

	return listRecentByActivityUnits(
		db,
		projectId,
		traceBudget,
		beforeStartedAt,
		beforeId,
	);
}
