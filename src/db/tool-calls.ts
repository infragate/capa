import type { Database } from "bun:sqlite";
import type { ToolCallRecord, ToolCallStats } from "../types/database";

export const TOOL_CALLS_PER_PROJECT_CAP = 1000;
export const TOOL_CALLS_PAGE_SIZE_DEFAULT = 50;
export const TOOL_CALLS_PAGE_SIZE_MAX = 100;

export type ToolCallInsert = Omit<ToolCallRecord, "duration_ms"> & {
	duration_ms?: number | null;
};

export type ToolCallFinish = {
	status: "ok" | "error";
	duration_ms: number;
	result_preview?: string | null;
	result_bytes?: number | null;
	result_tokens?: number | null;
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
};

export type ToolCallListResult = {
	calls: ToolCallRecord[];
	total: number;
	hasMore: boolean;
};

/** Matches web-ui `groupActivityRuns` openers. */
export function isActivityRunOpener(call: Pick<ToolCallRecord, "kind" | "tool_name">): boolean {
	if (call.kind === "prompt") return true;
	if (call.kind === "session" && /start/i.test(call.tool_name)) return true;
	return false;
}

/** Matches web-ui `groupActivityRuns` closers. */
export function isActivityRunCloser(call: Pick<ToolCallRecord, "kind" | "tool_name">): boolean {
	if (call.kind === "stop") return true;
	if (call.kind === "session" && /end/i.test(call.tool_name)) return true;
	return false;
}

/** Cap how far we walk older rows to complete a cut-off run. */
const RUN_BOUNDARY_EXPAND_MAX = TOOL_CALLS_PER_PROJECT_CAP;

export class ToolCallsRepo {
	constructor(private db: Database) {}

	insert(row: ToolCallInsert): ToolCallRecord {
		this.db.run(
			`INSERT INTO tool_calls (
        id, project_id, session_id, started_at, duration_ms, status, source,
        kind, tool_name, meta_tool, args_json, result_preview, result_bytes,
        result_tokens, error_message, agent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				row.error_message,
				row.agent_id,
			],
		);
		this.prune(row.project_id);
		return this.get(row.id)!;
	}

	finish(id: string, update: ToolCallFinish): ToolCallRecord | null {
		this.db.run(
			`UPDATE tool_calls
       SET status = ?, duration_ms = ?, result_preview = ?, result_bytes = ?,
           result_tokens = ?, error_message = ?
       WHERE id = ?`,
			[
				update.status,
				update.duration_ms,
				update.result_preview ?? null,
				update.result_bytes ?? null,
				update.result_tokens ?? null,
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

	count(projectId: string): number {
		const row = this.db
			.query("SELECT COUNT(*) AS n FROM tool_calls WHERE project_id = ?")
			.get(projectId) as { n: number };
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
	 * If the page's oldest row is mid-run, pull older rows until the run
	 * opener (prompt / session start). Stops before a prior run's closer.
	 * If no run boundary is found within the expand budget (e.g. unstructured
	 * tool-only history), leaves the original page unchanged so pagination
	 * still works.
	 */
	private expandOlderToRunBoundary(
		projectId: string,
		page: ToolCallRecord[],
	): ToolCallRecord[] {
		if (page.length === 0) return page;
		const oldest = page[page.length - 1]!;
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
				// Start of history with no opener — leave the page as-is so
				// unstructured tool-only feeds still paginate.
				break;
			}

			for (const row of batch) {
				walked += 1;
				if (isActivityRunCloser(row)) {
					// Prior run ended here; do not attach it to this page's group.
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

	listRecent(
		projectId: string,
		options: ToolCallListOptions = {},
	): ToolCallListResult {
		const limit = Math.max(
			1,
			Math.min(
				options.limit ?? TOOL_CALLS_PAGE_SIZE_DEFAULT,
				TOOL_CALLS_PAGE_SIZE_MAX,
			),
		);
		const beforeStartedAt =
			options.beforeStartedAt ?? options.before ?? null;
		const beforeId = options.beforeId ?? null;

		const fetched = (
			beforeStartedAt == null
				? this.db
						.query(
							`SELECT * FROM tool_calls
             WHERE project_id = ?
             ORDER BY started_at DESC, id DESC
             LIMIT ?`,
						)
						.all(projectId, limit + 1)
				: beforeId
					? this.db
							.query(
								`SELECT * FROM tool_calls
             WHERE project_id = ?
               AND (started_at < ? OR (started_at = ? AND id < ?))
             ORDER BY started_at DESC, id DESC
             LIMIT ?`,
							)
							.all(
								projectId,
								beforeStartedAt,
								beforeStartedAt,
								beforeId,
								limit + 1,
							)
					: this.db
							.query(
								`SELECT * FROM tool_calls
             WHERE project_id = ? AND started_at < ?
             ORDER BY started_at DESC, id DESC
             LIMIT ?`,
							)
							.all(projectId, beforeStartedAt, limit + 1)
		) as ToolCallRecord[];

		const overflow = fetched.length > limit;
		if (overflow) fetched.pop();

		const calls = this.expandOlderToRunBoundary(projectId, fetched);

		let hasMore = false;
		if (calls.length > 0) {
			const oldest = calls[calls.length - 1]!;
			hasMore = this.hasRowBefore(projectId, oldest.started_at, oldest.id);
		}

		return {
			calls,
			total: this.count(projectId),
			hasMore,
		};
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
			if (row.source === "shell") shell += 1;
			else mcp += 1;
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
