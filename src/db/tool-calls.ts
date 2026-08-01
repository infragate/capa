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
	/** Exclusive upper bound on started_at (for "load older" pagination). */
	before?: number | null;
};

export type ToolCallListResult = {
	calls: ToolCallRecord[];
	total: number;
	hasMore: boolean;
};

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
		const before = options.before ?? null;

		const calls = (
			before == null
				? this.db
						.query(
							`SELECT * FROM tool_calls
             WHERE project_id = ?
             ORDER BY started_at DESC
             LIMIT ?`,
						)
						.all(projectId, limit + 1)
				: this.db
						.query(
							`SELECT * FROM tool_calls
             WHERE project_id = ? AND started_at < ?
             ORDER BY started_at DESC
             LIMIT ?`,
						)
						.all(projectId, before, limit + 1)
		) as ToolCallRecord[];

		const hasMore = calls.length > limit;
		if (hasMore) calls.pop();

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

		this.db.run(
			`DELETE FROM tool_calls
       WHERE id IN (
         SELECT id FROM tool_calls
         WHERE project_id = ?
         ORDER BY started_at ASC
         LIMIT ?
       )`,
			[projectId, excess],
		);
		return excess;
	}

	deleteForProject(projectId: string): void {
		this.db.run("DELETE FROM tool_calls WHERE project_id = ?", [projectId]);
	}
}
