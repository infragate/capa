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
