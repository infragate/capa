/**
 * System agent-activity monitoring — capa-owned hooks + helpers.
 *
 * Hooks are injected at install time (not declared in capabilities.yaml).
 * Ids use {@link SYSTEM_ACTIVITY_HOOK_PREFIX} so the UI can hide them from
 * the Hooks list while Options + Activity remain visible.
 *
 * Event set is **outcome-focused** (not full before/after lifecycle) so the
 * Activity feed stays readable: one row per meaningful action.
 */

import type { CapabilitiesOptions } from "../types/capabilities";
import type { CanonicalHookEvent, Hook } from "../types/hooks";
import { getProvider } from "./providers";

export const SYSTEM_ACTIVITY_HOOK_PREFIX = "capa-sys-activity-";

/**
 * Lifecycle events we install for observability.
 * Intentionally omits all `before*` hooks — those double every action
 * (e.g. Cursor `beforeReadFile` + `postToolUse`/`Read`) without adding
 * user-facing value. File reads/skills show up via `afterTool`; edits via
 * `afterFileEdit`.
 *
 * Per-provider install filters this list to events the provider actually maps
 * (see {@link buildSystemActivityHooks}) so wrap/install stays quiet.
 */
export const SYSTEM_ACTIVITY_EVENTS: readonly CanonicalHookEvent[] = [
	"sessionStart",
	"sessionEnd",
	"userPromptSubmit",
	"afterTool",
	"afterToolFailure",
	"afterShell",
	"afterFileEdit",
	"afterMcpCall",
	"subagentStart",
	"subagentStop",
	"preCompact",
	"stop",
] as const;

export function isSystemActivityHookId(id: string): boolean {
	return id.startsWith(SYSTEM_ACTIVITY_HOOK_PREFIX);
}

/** Default-on: omitted / undefined means enabled. */
export function isAgentActivityEnabled(
	options: CapabilitiesOptions | null | undefined,
): boolean {
	return options?.agentActivity !== false;
}

export function systemActivityHookId(event: CanonicalHookEvent): string {
	return `${SYSTEM_ACTIVITY_HOOK_PREFIX}${event}`;
}

/**
 * Build the fixed bundle of command hooks that report agent activity.
 * Command is OS-agnostic: relies on `capa` being on PATH.
 * When `providerId` is set, it is stamped into the ingest command so traces
 * are labeled with that provider (not left null → UI "MCP"), and only events
 * that provider maps are included (avoids skip warnings on wrap/install).
 */
export function buildSystemActivityHooks(
	projectId: string,
	providerId?: string,
): Hook[] {
	const providerArg = providerId
		? ` --provider ${shellQuote(providerId)}`
		: "";
	const events = providerId
		? SYSTEM_ACTIVITY_EVENTS.filter((event) =>
				providerMapsActivityEvent(providerId, event),
			)
		: SYSTEM_ACTIVITY_EVENTS;
	return events.map((event) => ({
		id: systemActivityHookId(event),
		on: event,
		type: "command" as const,
		description: `capa agent activity (${event})`,
		command: `capa activity-ingest --project ${shellQuote(projectId)} --event ${event}${providerArg}`,
	}));
}

function providerMapsActivityEvent(
	providerId: string,
	event: CanonicalHookEvent,
): boolean {
	const provider = getProvider(providerId);
	const map = provider?.hooks?.eventMap;
	if (!map) return false;
	return event in map;
}

/** Minimal quoting so project ids with spaces/special chars survive shell. */
function shellQuote(value: string): string {
	if (/^[A-Za-z0-9._@+-]+$/.test(value)) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
