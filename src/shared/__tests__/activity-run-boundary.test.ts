import { describe, expect, it } from "bun:test";
import {
	isActivityRunCloser,
	isActivityRunOpener,
} from "../activity-run-boundary";

describe("activity-run-boundary", () => {
	it("treats prompts and session starts as openers", () => {
		expect(isActivityRunOpener({ kind: "prompt", tool_name: "hi" })).toBe(true);
		expect(
			isActivityRunOpener({ kind: "session", tool_name: "sessionStart" }),
		).toBe(true);
		expect(isActivityRunOpener({ kind: "shell", tool_name: "ls" })).toBe(false);
	});

	it("treats stop and session ends as closers", () => {
		expect(isActivityRunCloser({ kind: "stop", tool_name: "stop" })).toBe(true);
		expect(
			isActivityRunCloser({ kind: "session", tool_name: "sessionEnd" }),
		).toBe(true);
		expect(isActivityRunCloser({ kind: "prompt", tool_name: "hi" })).toBe(false);
	});
});
