import type { Database } from "bun:sqlite";
import {
	isActivityRunCloser,
	isActivityRunOpener,
} from "../shared/activity-run-boundary";
import type { ToolCallRecord, ToolCallStats } from "../types/database";
import { listRecentToolCalls } from "./tool-calls-activity-page";

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
	/** When set, return all rows for this provider generation id. */
	generationId?: string | null;
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

	listRecent(
		projectId: string,
		options: ToolCallListOptions = {},
	): ToolCallListResult {
		return listRecentToolCalls(this.db, projectId, options);
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
