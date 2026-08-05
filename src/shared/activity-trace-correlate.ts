/**
 * Pair capa `capa sh` traces with provider afterShell hooks by parsed command
 * and time window. Unmatched capa shell traces stay uncorrelated and are hidden
 * from the activity feed.
 */

import {
	capaShSegmentsFromHookRow,
	capaShSegmentsMatchQualifiedTool,
} from "./activity-capa-sh-command";
import type { ToolCallRecord } from "../types/database";
import {
	ACTIVITY_TRACE_LINK_WINDOW_MS,
	activityTraceLinkTimeBounds,
	isCapaShellActivitySource,
	isProviderShellHookRow,
	providerShellLooksLikeCapaSh,
} from "./activity-shell-classify";

/** Capa MCP trace usually finishes shortly before the provider afterShell hook. */
const CAPA_BEFORE_HOOK_SLACK_MS = 5_000;

/** Reject pairing when two same-tool capa traces sit within this window. */
const SAME_TOOL_AMBIGUITY_MS = 2_000;

export type ActivityTraceCorrelateDb = {
	findUncorrelatedCapaShellTracesInWindow(input: {
		projectId: string;
		since: number;
		until: number;
	}): ToolCallRecord[];
	findProviderCapaShHooksInWindow(input: {
		projectId: string;
		since: number;
		until: number;
	}): ToolCallRecord[];
	patchToolCallCorrelation(
		id: string,
		correlation: { conversation_id: string; generation_id: string | null },
	): ToolCallRecord | null;
};

export function pickUniqueCapaShProviderShellMatch(
	candidates: readonly ToolCallRecord[],
): ToolCallRecord | null {
	const capaSh = candidates.filter((row) => providerShellLooksLikeCapaSh(row));
	if (capaSh.length === 1) return capaSh[0]!;
	if (capaSh.length > 1) return null;
	if (candidates.length === 1) return candidates[0]!;
	return null;
}

function capaTraceNeedsCorrelation(row: ToolCallRecord): boolean {
	if (!isCapaShellActivitySource(row.source)) return false;
	return !row.conversation_id?.trim();
}

function hookMatchesCapaTool(hook: ToolCallRecord, qualifiedToolName: string): boolean {
	const segments = capaShSegmentsFromHookRow(hook);
	if (!segments) return false;
	return capaShSegmentsMatchQualifiedTool(segments, qualifiedToolName);
}

function patchFromHook(
	db: ActivityTraceCorrelateDb,
	capaId: string,
	hook: ToolCallRecord,
): ToolCallRecord | null {
	if (!hook.conversation_id?.trim()) return null;
	return db.patchToolCallCorrelation(capaId, {
		conversation_id: hook.conversation_id.trim(),
		generation_id: hook.generation_id,
	});
}

/** Prefer the uncorrelated capa trace for this tool just before the hook fired. */
export function pickCapaTraceForProviderHook(
	hook: ToolCallRecord,
	candidates: readonly ToolCallRecord[],
): ToolCallRecord | null {
	const hookT = hook.started_at;
	const matching = candidates.filter((c) =>
		hookMatchesCapaTool(hook, c.tool_name),
	);
	if (matching.length === 0) return null;

	const eligible = matching.filter(
		(c) => c.started_at <= hookT + CAPA_BEFORE_HOOK_SLACK_MS,
	);
	const pool = eligible.length > 0 ? eligible : matching;
	pool.sort((a, b) => b.started_at - a.started_at);

	const best = pool[0]!;
	const near = pool.filter(
		(c) =>
			c.id !== best.id &&
			Math.abs(c.started_at - best.started_at) < SAME_TOOL_AMBIGUITY_MS &&
			c.tool_name === best.tool_name,
	);
	if (near.length > 0) return null;

	return best;
}

/** Prefer the provider hook that ran just after this capa trace. */
export function pickProviderHookForCapaTrace(
	capa: ToolCallRecord,
	hooks: readonly ToolCallRecord[],
): ToolCallRecord | null {
	const capaT = capa.started_at;
	const matching = hooks.filter((h) => hookMatchesCapaTool(h, capa.tool_name));
	if (matching.length === 0) return null;

	const afterCapa = matching.filter((h) => h.started_at >= capaT - 1_000);
	const pool = afterCapa.length > 0 ? afterCapa : matching;
	pool.sort((a, b) => a.started_at - b.started_at);

	return pickUniqueCapaShProviderShellMatch(pool) ?? (pool.length === 1 ? pool[0]! : null);
}

function tryLinkByCapaShCommandFromCapaTrace(
	db: ActivityTraceCorrelateDb,
	record: ToolCallRecord,
): ToolCallRecord | null {
	const { since, until } = activityTraceLinkTimeBounds(record.started_at);
	const hooks = db
		.findProviderCapaShHooksInWindow({
			projectId: record.project_id,
			since,
			until,
		})
		.filter((row) => row.id !== record.id);

	const hook = pickProviderHookForCapaTrace(record, hooks);
	if (!hook) return null;
	return patchFromHook(db, record.id, hook);
}

function tryLinkByCapaShCommandFromProviderHook(
	db: ActivityTraceCorrelateDb,
	hookRow: ToolCallRecord,
): ToolCallRecord | null {
	const segments = capaShSegmentsFromHookRow(hookRow);
	if (!segments) return null;

	const { since, until } = activityTraceLinkTimeBounds(hookRow.started_at);
	const capaRows = db
		.findUncorrelatedCapaShellTracesInWindow({
			projectId: hookRow.project_id,
			since,
			until,
		})
		.filter(capaTraceNeedsCorrelation)
		.filter((c) => capaShSegmentsMatchQualifiedTool(segments, c.tool_name));

	const capa = pickCapaTraceForProviderHook(hookRow, capaRows);
	if (!capa) return null;
	return patchFromHook(db, capa.id, hookRow);
}

/**
 * After a capa shell trace finishes, copy conversation/generation from a matching
 * provider afterShell hook when the pairing is unambiguous.
 */
export function tryLinkCapaShellTraceAfterFinish(
	db: ActivityTraceCorrelateDb,
	record: ToolCallRecord,
): ToolCallRecord | null {
	if (!capaTraceNeedsCorrelation(record)) return null;
	return tryLinkByCapaShCommandFromCapaTrace(db, record);
}

/**
 * After a provider shell hook is ingested, attach its correlation to a capa shell
 * trace (hook may arrive before or after capa finish).
 */
export function tryLinkCapaShellTraceFromProviderHook(
	db: ActivityTraceCorrelateDb,
	hookRow: ToolCallRecord,
): ToolCallRecord | null {
	if (!isProviderShellHookRow(hookRow)) return null;
	if (!hookRow.conversation_id?.trim()) return null;
	return tryLinkByCapaShCommandFromProviderHook(db, hookRow);
}

export { ACTIVITY_TRACE_LINK_WINDOW_MS };
