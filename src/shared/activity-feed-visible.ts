/**
 * Which persisted activity rows belong in the project UI feed.
 * Uncorrelated capa MCP / `capa sh` traces are stored for linking attempts
 * but omitted from history once they fail to pair with a provider turn.
 */

export function isCapaOriginatedActivityRow(row: {
	source: string | null;
	kind: string;
	meta_tool?: string | null;
}): boolean {
	if (row.source === "shell" || row.source === "mcp") return true;
	if (
		row.kind === "setup_tools" ||
		row.kind === "call_tool" ||
		row.kind === "tool"
	) {
		const meta = row.meta_tool;
		if (meta === "call_tool" || meta === "setup_tools") return true;
	}
	return false;
}

/** Provider-correlated capa traces only; everything else in the feed stays visible. */
export function isVisibleInActivityFeed(row: {
	source: string | null;
	kind: string;
	meta_tool?: string | null;
	conversation_id?: string | null;
}): boolean {
	if (!isCapaOriginatedActivityRow(row)) return true;
	return Boolean(row.conversation_id?.trim());
}

export function filterVisibleActivityFeed<
	T extends {
		source: string | null;
		kind: string;
		meta_tool?: string | null;
		conversation_id?: string | null;
	},
>(calls: readonly T[]): T[] {
	return calls.filter(isVisibleInActivityFeed);
}

type VisibleActivityRow = {
	id: string;
	started_at: number;
	source: string | null;
	kind: string;
	meta_tool?: string | null;
	conversation_id?: string | null;
};

export type VisibleActivityListPage<T extends VisibleActivityRow> = {
	calls: T[];
	total: number;
	hasMore: boolean;
};

/**
 * Page visible activity rows without dead-ending when a raw page is entirely
 * hidden (uncorrelated capa traces). Keeps fetching older raw pages until it
 * accumulates `limit` visible rows or exhausts history.
 */
export function listVisibleActivityPage<T extends VisibleActivityRow>(
	listRaw: (options: {
		limit: number;
		beforeStartedAt?: number | null;
		beforeId?: string | null;
	}) => VisibleActivityListPage<T>,
	options: {
		limit: number;
		beforeStartedAt?: number | null;
		beforeId?: string | null;
	},
): VisibleActivityListPage<T> {
	const limit = Math.max(1, options.limit);
	const visible: T[] = [];
	const seen = new Set<string>();
	let beforeStartedAt = options.beforeStartedAt ?? null;
	let beforeId = options.beforeId ?? null;
	let total = 0;
	let rawHasMore = false;
	// Cap walk so a pathological mix of hidden rows cannot loop forever.
	const maxPages = 50;

	for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
		const page = listRaw({
			limit,
			beforeStartedAt,
			beforeId,
		});
		total = page.total;
		rawHasMore = page.hasMore;

		if (page.calls.length === 0) {
			rawHasMore = false;
			break;
		}

		for (const call of page.calls) {
			if (seen.has(call.id)) continue;
			seen.add(call.id);
			if (isVisibleInActivityFeed(call)) {
				visible.push(call);
			}
		}

		const oldest = page.calls[page.calls.length - 1]!;
		beforeStartedAt = oldest.started_at;
		beforeId = oldest.id;

		if (visible.length >= limit || !rawHasMore) break;
	}

	const calls = visible.slice(0, limit);
	const hasMore = visible.length > limit || rawHasMore;
	return { calls, total, hasMore };
}
