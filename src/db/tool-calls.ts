import type { Database } from "bun:sqlite";
import {
	isActivityRunCloser,
	isActivityRunOpener,
} from "../shared/activity-run-boundary";
import type { ToolCallRecord, ToolCallStats } from "../types/database";

export const TOOL_CALLS_PER_PROJECT_CAP = 10_000;
export const TOOL_CALLS_PAGE_SIZE_DEFAULT = 50;
export const TOOL_CALLS_PAGE_SIZE_MAX = 100;

export type ToolCallInsert = Omit<
	ToolCallRecord,
	| "duration_ms"
	| "input_tokens"
	| "output_tokens"
	| "cache_read_tokens"
	| "cache_write_tokens"
	| "conversation_id"
	| "generation_id"
	| "model"
	| "attributes_json"
> & {
	duration_ms?: number | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_tokens?: number | null;
	cache_write_tokens?: number | null;
	conversation_id?: string | null;
	generation_id?: string | null;
	model?: string | null;
	attributes_json?: string | null;
};

export type ToolCallFinish = {
	status: "ok" | "error";
	duration_ms: number;
	result_preview?: string | null;
	result_bytes?: number | null;
	result_tokens?: number | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_tokens?: number | null;
	cache_write_tokens?: number | null;
	error_message?: string | null;
};

export type ToolCallListOptions = {
	limit?: number;
	/**
	 * Composite "load older" cursor: rows strictly before
	 * `(beforeStartedAt, beforeId)` in `(started_at DESC, id DESC)` order.
	 */
	beforeStartedAt?: number | null;
	beforeId?: string | null;
	/** @deprecated Prefer beforeStartedAt + beforeId. Kept for older clients. */
	before?: number | null;
	/** When set, return only rows for this agent session id. */
	sessionId?: string | null;
	/** When set, return all rows for this provider conversation id. */
	conversationId?: string | null;
};

export type ToolCallListResult = {
	calls: ToolCallRecord[];
	total: number;
	hasMore: boolean;
};

/** Correlation ids from a recent provider-hook activity row. */
export type ActivityCorrelationLookup = {
	conversation_id: string;
	generation_id: string | null;
	source: string | null;
};

export { isActivityRunCloser, isActivityRunOpener };

/** Cap how far we walk older rows to complete a cut-off run. */
const RUN_BOUNDARY_EXPAND_MAX = TOOL_CALLS_PER_PROJECT_CAP;

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

export class ToolCallsRepo {
	constructor(private db: Database) {}

	insert(row: ToolCallInsert): ToolCallRecord {
		this.db.run(
			`INSERT INTO tool_calls (
        id, project_id, session_id, started_at, duration_ms, status, source,
        kind, tool_name, meta_tool, args_json, result_preview, result_bytes,
        result_tokens, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, error_message, agent_id, conversation_id,
        generation_id, model, attributes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				row.id,
				row.project_id,
				row.session_id,
				row.started_at,
				row.duration_ms ?? null,
				row.status,
				row.source,
				row.kind,
				row.tool_name,
				row.meta_tool,
				row.args_json,
				row.result_preview,
				row.result_bytes ?? null,
				row.result_tokens ?? null,
				row.input_tokens ?? null,
				row.output_tokens ?? null,
				row.cache_read_tokens ?? null,
				row.cache_write_tokens ?? null,
				row.error_message,
				row.agent_id,
				row.conversation_id ?? null,
				row.generation_id ?? null,
				row.model ?? null,
				row.attributes_json ?? null,
			],
		);
		this.prune(row.project_id);
		return this.get(row.id)!;
	}

	finish(id: string, update: ToolCallFinish): ToolCallRecord | null {
		this.db.run(
			`UPDATE tool_calls
       SET status = ?, duration_ms = ?, result_preview = ?, result_bytes = ?,
           result_tokens = ?, input_tokens = COALESCE(?, input_tokens),
           output_tokens = COALESCE(?, output_tokens),
           cache_read_tokens = COALESCE(?, cache_read_tokens),
           cache_write_tokens = COALESCE(?, cache_write_tokens),
           error_message = ?
       WHERE id = ?`,
			[
				update.status,
				update.duration_ms,
				update.result_preview ?? null,
				update.result_bytes ?? null,
				update.result_tokens ?? null,
				update.input_tokens ?? null,
				update.output_tokens ?? null,
				update.cache_read_tokens ?? null,
				update.cache_write_tokens ?? null,
				update.error_message ?? null,
				id,
			],
		);
		return this.get(id);
	}

	get(id: string): ToolCallRecord | null {
		return this.db
			.query("SELECT * FROM tool_calls WHERE id = ?")
			.get(id) as ToolCallRecord | null;
	}

	/**
	 * Latest provider-hook correlation for a project (used so capa MCP traces
	 * can join the active conversation/generation).
	 */
	findLatestCorrelation(
		projectId: string,
		withinMs = 60 * 60 * 1000,
		nowMs = Date.now(),
	): ActivityCorrelationLookup | null {
		const since = nowMs - withinMs;
		const row = this.db
			.query(
				`SELECT conversation_id, generation_id, source
         FROM tool_calls
         WHERE project_id = ?
           AND conversation_id IS NOT NULL
           AND conversation_id <> ''
           AND started_at >= ?
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
			)
			.get(projectId, since) as {
			conversation_id: string;
			generation_id: string | null;
			source: string | null;
		} | null;
		if (!row?.conversation_id) return null;
		return {
			conversation_id: row.conversation_id,
			generation_id: row.generation_id,
			source: row.source,
		};
	}

	count(projectId: string): number {
		const row = this.db
			.query("SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ?")
			.get(projectId) as { n: number };
		return row.n;
	}

	countForSession(projectId: string, sessionId: string): number {
		const row = this.db
			.query(
				"SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ? AND session_id = ?",
			)
			.get(projectId, sessionId) as { n: number };
		return row.n;
	}

	/** Rows strictly older than `(startedAt, id)` in newest-first order. */
	private listBefore(
		projectId: string,
		startedAt: number,
		id: string,
		limit: number,
	): ToolCallRecord[] {
		return this.db
			.query(
				`SELECT * FROM tool_calls
         WHERE project_id = ?
           AND (started_at < ? OR (started_at = ? AND id < ?))
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
			)
			.all(projectId, startedAt, startedAt, id, limit) as ToolCallRecord[];
	}

	private hasRowBefore(
		projectId: string,
		startedAt: number,
		id: string,
	): boolean {
		const row = this.db
			.query(
				`SELECT 1 AS ok FROM tool_calls
         WHERE project_id = ?
           AND (started_at < ? OR (started_at = ? AND id < ?))
         LIMIT 1`,
			)
			.get(projectId, startedAt, startedAt, id) as { ok: number } | null;
		return row != null;
	}

	/**
	 * If the page's oldest row is mid-generation (or mid-heuristic-run), pull
	 * older rows until the generation / run opener. Prefer provider generation
	 * ids when present; fall back to prompt/stop heuristics.
	 */
	private expandOlderToRunBoundary(
		projectId: string,
		page: ToolCallRecord[],
	): ToolCallRecord[] {
		if (page.length === 0) return page;
		const oldest = page[page.length - 1]!;

		if (oldest.generation_id) {
			return this.expandOlderMatching(
				projectId,
				page,
				(row) => row.generation_id === oldest.generation_id,
			);
		}

		if (isActivityRunOpener(oldest)) return page;

		const expanded = [...page];
		let walked = 0;
		let foundBoundary = false;

		while (walked < RUN_BOUNDARY_EXPAND_MAX) {
			const tip = expanded[expanded.length - 1]!;
			const batchSize = Math.min(50, RUN_BOUNDARY_EXPAND_MAX - walked);
			const batch = this.listBefore(
				projectId,
				tip.started_at,
				tip.id,
				batchSize,
			);
			if (batch.length === 0) {
				break;
			}

			for (const row of batch) {
				walked += 1;
				if (isActivityRunCloser(row)) {
					foundBoundary = true;
					break;
				}
				expanded.push(row);
				if (isActivityRunOpener(row)) {
					foundBoundary = true;
					break;
				}
				if (walked >= RUN_BOUNDARY_EXPAND_MAX) break;
			}

			if (foundBoundary) break;
			if (batch.length < batchSize) break;
			if (walked >= RUN_BOUNDARY_EXPAND_MAX) break;
		}

		return foundBoundary ? expanded : page;
	}

	/** Pull older rows while `matches` stays true (e.g. same generation_id). */
	private expandOlderMatching(
		projectId: string,
		page: ToolCallRecord[],
		matches: (row: ToolCallRecord) => boolean,
	): ToolCallRecord[] {
		const expanded = [...page];
		let walked = 0;

		while (walked < RUN_BOUNDARY_EXPAND_MAX) {
			const tip = expanded[expanded.length - 1]!;
			const batchSize = Math.min(50, RUN_BOUNDARY_EXPAND_MAX - walked);
			const batch = this.listBefore(
				projectId,
				tip.started_at,
				tip.id,
				batchSize,
			);
			if (batch.length === 0) break;

			let hitMismatch = false;
			for (const row of batch) {
				walked += 1;
				if (!matches(row)) {
					hitMismatch = true;
					break;
				}
				expanded.push(row);
				if (walked >= RUN_BOUNDARY_EXPAND_MAX) break;
			}

			if (hitMismatch) break;
			if (batch.length < batchSize) break;
			if (walked >= RUN_BOUNDARY_EXPAND_MAX) break;
		}

		return expanded;
	}

	listRecent(
		projectId: string,
		options: ToolCallListOptions = {},
	): ToolCallListResult {
		const traceBudget = Math.max(
			1,
			Math.min(
				options.limit ?? TOOL_CALLS_PAGE_SIZE_DEFAULT,
				TOOL_CALLS_PAGE_SIZE_MAX,
			),
		);
		const beforeStartedAt = options.beforeStartedAt ?? options.before ?? null;
		const beforeId = options.beforeId ?? null;
		const sessionId = options.sessionId?.trim() || null;
		const conversationId = options.conversationId?.trim() || null;

		if (sessionId) {
			let fetched: ToolCallRecord[];
			if (beforeStartedAt != null && beforeId) {
				fetched = this.db
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
				fetched = this.db
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
				fetched = this.db
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
				total: this.countForSession(projectId, sessionId),
				hasMore: overflow,
			};
		}

		if (conversationId) {
			const fetched = this.db
				.query(
					`SELECT * FROM tool_calls
           WHERE project_id = ? AND conversation_id = ?
           ORDER BY started_at DESC, id DESC`,
				)
				.all(projectId, conversationId) as ToolCallRecord[];

			return {
				calls: fetched,
				total: fetched.length,
				hasMore: false,
			};
		}

		return this.listRecentByActivityUnits(
			projectId,
			traceBudget,
			beforeStartedAt,
			beforeId,
		);
	}

	/**
	 * Paginate activity by full conversations (or orphan run units), packing
	 * units until the trace budget is reached. A single unit larger than the
	 * budget is returned alone.
	 */
	private listRecentByActivityUnits(
		projectId: string,
		traceBudget: number,
		beforeStartedAt: number | null,
		beforeId: string | null,
	): ToolCallListResult {
		const cursor =
			beforeStartedAt != null && beforeId
				? this.resolveActivityPageCursor(
						projectId,
						beforeStartedAt,
						beforeId,
					)
				: beforeStartedAt != null
					? { maxStarted: beforeStartedAt, unitKey: "" }
					: null;

		const units = this.listActivityPageUnits(projectId, cursor);
		const selected = this.selectUnitsByTraceBudget(units, traceBudget);
		const calls = this.fetchTracesForActivityUnits(projectId, selected);

		return {
			calls,
			total: this.count(projectId),
			hasMore: selected.length < units.length,
		};
	}

	private listActivityPageUnits(
		projectId: string,
		cursor?: { maxStarted: number; unitKey: string } | null,
	): ActivityPageUnit[] {
		const conversationRows = this.db
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

		const orphanRows = this.db
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

	private resolveActivityPageCursor(
		projectId: string,
		beforeStartedAt: number,
		beforeId: string,
	): { maxStarted: number; unitKey: string } {
		const row = this.get(beforeId);
		if (!row || row.project_id !== projectId) {
			return { maxStarted: beforeStartedAt, unitKey: "" };
		}

		if (row.conversation_id) {
			const summary = this.db
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
		const summary = this.db
			.query(
				`SELECT MAX(started_at) AS max_started FROM tool_calls
         WHERE project_id = ? AND conversation_id IS NULL
           AND (generation_id = ? OR (generation_id IS NULL AND id = ?))`,
			)
			.get(projectId, orphanKey, orphanKey) as { max_started: number } | null;

		return {
			maxStarted: summary
				? Number(summary.max_started)
				: beforeStartedAt,
			unitKey: orphanKey,
		};
	}

	private selectUnitsByTraceBudget(
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

	private fetchTracesForActivityUnits(
		projectId: string,
		units: ActivityPageUnit[],
	): ToolCallRecord[] {
		const calls: ToolCallRecord[] = [];
		for (const unit of units) {
			if (unit.kind === "conversation") {
				const rows = this.db
					.query(
						`SELECT * FROM tool_calls
             WHERE project_id = ? AND conversation_id = ?
             ORDER BY started_at DESC, id DESC`,
					)
					.all(projectId, unit.unitKey) as ToolCallRecord[];
				calls.push(...rows);
			} else {
				const rows = this.db
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
	 * 60 one-minute buckets covering the last hour (aligned to clock minutes).
	 * `max X` is the current minute; `min X` is 59 minutes earlier.
	 */
	histogram(
		projectId: string,
		nowMs: number = Date.now(),
	): Array<{ t: number; count: number }> {
		const minuteMs = 60_000;
		const bucketCount = 60;
		const endBucket = Math.floor(nowMs / minuteMs);
		const startBucket = endBucket - (bucketCount - 1);
		const since = startBucket * minuteMs;

		const rows = this.db
			.query(
				`SELECT (started_at / ?) * ? AS t, COUNT(*) AS count
         FROM tool_calls
         WHERE project_id = ? AND started_at >= ?
         GROUP BY t
         ORDER BY t`,
			)
			.all(minuteMs, minuteMs, projectId, since) as Array<{
			t: number;
			count: number;
		}>;

		const byT = new Map(rows.map((r) => [Number(r.t), Number(r.count)]));
		const buckets: Array<{ t: number; count: number }> = [];
		for (let b = startBucket; b <= endBucket; b++) {
			const t = b * minuteMs;
			buckets.push({ t, count: byT.get(t) ?? 0 });
		}
		return buckets;
	}

	stats(projectId: string, sinceMs?: number): ToolCallStats {
		const now = Date.now();
		const since = sinceMs ?? now - 60 * 60 * 1000;
		const rows = this.db
			.query(
				`SELECT status, source, duration_ms
         FROM tool_calls
         WHERE project_id = ? AND started_at >= ?`,
			)
			.all(projectId, since) as Array<{
			status: string;
			source: string | null;
			duration_ms: number | null;
		}>;

		let errors = 0;
		let shell = 0;
		let mcp = 0;
		let durationSum = 0;
		let durationCount = 0;

		for (const row of rows) {
			if (row.status === "error") errors += 1;
			// Only capa shell / capa MCP — provider hook sources (cursor, etc.) are neither.
			if (row.source === "shell") shell += 1;
			else if (row.source === "mcp") mcp += 1;
			if (typeof row.duration_ms === "number") {
				durationSum += row.duration_ms;
				durationCount += 1;
			}
		}

		return {
			total: rows.length,
			errors,
			avg_duration_ms:
				durationCount > 0 ? Math.round(durationSum / durationCount) : null,
			shell,
			mcp,
			window_ms: now - since,
			buckets: this.histogram(projectId, now),
		};
	}

	prune(projectId: string, cap = TOOL_CALLS_PER_PROJECT_CAP): number {
		const countRow = this.db
			.query("SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ?")
			.get(projectId) as { n: number };
		const excess = countRow.n - cap;
		if (excess <= 0) return 0;

		// Prefer deleting finished rows so in-flight traces can still be finalized.
		// If only running rows remain beyond the cap, leave them until they finish.
		const result = this.db.run(
			`DELETE FROM tool_calls
       WHERE id IN (
         SELECT id FROM tool_calls
         WHERE project_id = ? AND status <> 'running'
         ORDER BY started_at ASC, id ASC
         LIMIT ?
       )`,
			[projectId, excess],
		);
		return Number(result.changes ?? 0);
	}

	deleteForProject(projectId: string): void {
		this.db.run("DELETE FROM tool_calls WHERE project_id = ?", [projectId]);
	}
}
