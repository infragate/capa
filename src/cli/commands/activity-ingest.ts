/**
 * `capa activity-ingest` — fail-open reporter for provider lifecycle hooks.
 * Reads JSON from stdin, normalizes, POSTs to the local capa server.
 */

import { CANONICAL_HOOK_EVENTS, type CanonicalHookEvent } from "../../types/hooks";
import { loadSettings } from "../../shared/config";
import { normalizeActivityHookPayload } from "../../shared/agent-activity-normalize";
import { getServerStatus } from "../utils/server-manager";

export async function activityIngestCommand(
	args: string[],
): Promise<void> {
	// Always exit 0 from the process wrapper — this function may throw only
	// for programmer errors; soft failures return normally.
	try {
		await runIngest(args);
	} catch {
		/* fail-open */
	}
}

async function runIngest(args: string[]): Promise<void> {
	const { projectId, event, provider } = parseArgs(args);
	if (!projectId || !event) return;

	const stdinText = await readStdin();
	let raw: unknown = null;
	if (stdinText.trim()) {
		try {
			raw = JSON.parse(stdinText);
		} catch {
			raw = { raw: stdinText.slice(0, 4000) };
		}
	}

	const normalized = normalizeActivityHookPayload(event, raw, provider);
	if (normalized.skip) return;

	const status = await getServerStatus();
	if (!status.running || !status.url) {
		const settings = await loadSettings();
		const fallback = `http://127.0.0.1:${settings.server.port}`;
		await postEvent(fallback, projectId, normalized);
		return;
	}

	await postEvent(status.url, projectId, normalized);
}

async function postEvent(
	serverUrl: string,
	projectId: string,
	normalized: ReturnType<typeof normalizeActivityHookPayload>,
): Promise<void> {
	const base = serverUrl.replace(/\/$/, "");
	const url = `${base}/api/projects/${encodeURIComponent(projectId)}/activity/events`;
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				kind: normalized.kind,
				toolName: normalized.toolName,
				status: normalized.status,
				source: normalized.source,
				args: normalized.args,
				resultPreview: normalized.resultPreview,
				errorMessage: normalized.errorMessage,
			}),
			signal: AbortSignal.timeout(5000),
		});
	} catch {
		/* server down / timeout — fail-open */
	}
}

function parseArgs(args: string[]): {
	projectId: string | null;
	event: CanonicalHookEvent | null;
	provider: string | null;
} {
	let projectId: string | null = null;
	let event: CanonicalHookEvent | null = null;
	let provider: string | null = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--project" || a === "-p") {
			projectId = args[++i] ?? null;
		} else if (a === "--event" || a === "-e") {
			const v = args[++i] ?? null;
			if (v && (CANONICAL_HOOK_EVENTS as readonly string[]).includes(v)) {
				event = v as CanonicalHookEvent;
			}
		} else if (a === "--provider") {
			const v = args[++i]?.trim();
			provider = v || null;
		}
	}
	return { projectId, event, provider };
}

async function readStdin(): Promise<string> {
	try {
		if (process.stdin.isTTY) return "";
		return await Bun.stdin.text();
	} catch {
		return "";
	}
}
