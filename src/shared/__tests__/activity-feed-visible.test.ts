import { describe, expect, it } from "bun:test";
import {
	filterVisibleActivityFeed,
	isVisibleInActivityFeed,
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
});
