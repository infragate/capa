/**
 * Run openers/closers for agent-activity feed grouping and pagination expand.
 * Keep in sync with web-ui `groupActivityRuns` (imports these helpers).
 */

export type ActivityRunBoundaryCall = {
	kind: string;
	tool_name: string;
};

/** Opens a new run: user prompt, or session start. */
export function isActivityRunOpener(
	call: ActivityRunBoundaryCall,
): boolean {
	if (call.kind === "prompt") return true;
	if (call.kind === "session" && /start/i.test(call.tool_name)) return true;
	return false;
}

/** Closes the current run: stop, or session end. */
export function isActivityRunCloser(
	call: ActivityRunBoundaryCall,
): boolean {
	if (call.kind === "stop") return true;
	if (call.kind === "session" && /end/i.test(call.tool_name)) return true;
	return false;
}
