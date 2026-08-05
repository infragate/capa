import { describe, expect, it } from "bun:test";
import {
	filterVisibleActivityFeed,
	isVisibleInActivityFeed,
	listVisibleActivityPage,
} from "../activity-feed-visible";

describe("activity-feed-visible", () => {
	it("hides uncorrelated capa sh traces", () => {
		expect(
			isVisibleInActivityFeed({
				source: "shell",
				kind: "tool",
				conversation_id: null,
			}),
		).toBe(false);
	});

	it("shows capa traces after correlation", () => {
		expect(
			isVisibleInActivityFeed({
				source: "shell",
				kind: "tool",
				conversation_id: "conv-1",
			}),
		).toBe(true);
	});

	it("always shows provider hook rows", () => {
		expect(
			isVisibleInActivityFeed({
				source: "cursor",
				kind: "shell",
				conversation_id: null,
			}),
		).toBe(true);
	});

	it("filterVisibleActivityFeed drops only uncorrelated capa rows", () => {
		const rows = [
			{ source: "shell", kind: "tool", conversation_id: null },
			{ source: "cursor", kind: "prompt", conversation_id: "c1" },
			{ source: "mcp", kind: "call_tool", conversation_id: "c1" },
		];
		expect(filterVisibleActivityFeed(rows)).toHaveLength(2);
	});

	it("listVisibleActivityPage skips a leading page of hidden capa rows", () => {
		type Row = {
			id: string;
			started_at: number;
			source: string | null;
			kind: string;
			conversation_id: string | null;
		};
		const newestHidden: Row = {
			id: "h1",
			started_at: 300,
			source: "shell",
			kind: "tool",
			conversation_id: null,
		};
		const olderHidden: Row = {
			id: "h2",
			started_at: 200,
			source: "shell",
			kind: "tool",
			conversation_id: null,
		};
		const visible: Row = {
			id: "v1",
			started_at: 100,
			source: "cursor",
			kind: "prompt",
			conversation_id: "c1",
		};
		const all = [newestHidden, olderHidden, visible];

		const page = listVisibleActivityPage(
			({ limit, beforeStartedAt, beforeId }) => {
				let slice = all;
				if (beforeStartedAt != null) {
					slice = all.filter((row) => {
						if (row.started_at < beforeStartedAt) return true;
						if (row.started_at > beforeStartedAt) return false;
						return beforeId ? row.id < beforeId : true;
					});
				}
				const calls = slice.slice(0, limit);
				return {
					calls,
					total: all.length,
					hasMore: slice.length > calls.length,
				};
			},
			{ limit: 2 },
		);

		expect(page.calls.map((c) => c.id)).toEqual(["v1"]);
		expect(page.hasMore).toBe(false);
		expect(page.total).toBe(3);
	});
});
