/**
 * `capa activity-ingest` — fail-open reporter for provider lifecycle hooks.
 * Reads JSON from stdin, normalizes, POSTs to the local capa server.
 *
 * Gate hooks (beforeFileRead, subagentStart, …) require valid JSON on stdout.
 * Always emit an allow/continue decision so Cursor never treats empty stdout
 * as invalid JSON and blocks the action.
 */

import { CANONICAL_HOOK_EVENTS, type CanonicalHookEvent } from "../../types/hooks";
import { loadSettings } from "../../shared/config";
import { normalizeActivityHookPayload } from "../../shared/agent-activity-normalize";

/** Cursor (and similar) gate events that require a permission decision on stdout. */
const PERMISSION_GATE_EVENTS = new Set<CanonicalHookEvent>([
	"beforeFileRead",
	"beforeTool",
	"beforeShell",
	"beforeMcpCall",
	"subagentStart",
]);

/** Max time to wait for hook stdin before giving up (fail-open). */
const STDIN_READ_TIMEOUT_MS = 2_000;

/**
 * Stdout payload for provider gate hooks. Observational events return null
 * (empty stdout is fine). Must stay valid JSON — empty string is not.
 */
export function activityIngestGateStdout(
	event: CanonicalHookEvent | null,
): string | null {
	if (!event) return null;
	if (PERMISSION_GATE_EVENTS.has(event)) {
		return JSON.stringify({ permission: "allow" });
	}
	if (event === "userPromptSubmit") {
		return JSON.stringify({ continue: true });
	}
	return null;
}

export async function activityIngestCommand(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	// Emit gate JSON first so Cursor never blocks while we read stdin / POST.
	const gate = activityIngestGateStdout(parsed.event);
	if (gate) writeGateStdout(`${gate}\n`);

	// Soft failures only — never throw out of the hook subprocess.
	try {
		await runIngest(parsed);
	} catch {
		/* fail-open */
	}
}

/**
 * Fail-open stdout write for gate JSON. Broken pipes / closed stdout must not
 * escape the ingest command and fail the provider hook.
 */
function writeGateStdout(line: string): void {
	try {
		process.stdout.once("error", () => {
			/* swallow stream errors (e.g. EPIPE) */
		});
		process.stdout.write(line);
	} catch {
		/* synchronous write failure — fail-open */
	}
}

async function runIngest(parsed: {
	projectId: string | null;
	event: CanonicalHookEvent | null;
	provider: string | null;
}): Promise<void> {
	const { projectId, event, provider } = parsed;
	if (!projectId || !event) return;

	const stdinText = await readStdin();
	let raw: unknown = null;
	if (stdinText.trim()) {
		raw = parseHookStdinJson(stdinText);
	}

	const normalized = normalizeActivityHookPayload(event, raw, provider);
	if (normalized.skip) return;

	const settings = await loadSettings();
	// Always derive a client-routable origin (0.0.0.0 / :: are not fetchable).
	const serverUrl = clientConnectOrigin(
		settings.server.host,
		settings.server.port,
	);
	await postEvent(serverUrl, projectId, normalized);
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
				tokenUsage: normalized.tokenUsage ?? null,
				conversationId: normalized.conversationId ?? null,
				generationId: normalized.generationId ?? null,
				model: normalized.model ?? null,
				attributes: normalized.attributes ?? null,
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
		// Hook hosts usually write stdin then close; don't hang forever if they don't.
		return await Promise.race([
			Bun.stdin.text(),
			new Promise<string>((resolve) => {
				setTimeout(() => resolve(""), STDIN_READ_TIMEOUT_MS);
			}),
		]);
	} catch {
		return "";
	}
}

/**
 * Parse provider hook stdin JSON.
 * Cursor Agent on Windows often prefixes UTF-8 BOM (`U+FEFF`); strip it so
 * `JSON.parse` succeeds and correlation / attributes / tokens are extracted.
 */
export function parseHookStdinJson(stdinText: string): unknown {
	const trimmed = stripBom(stdinText).trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return { raw: trimmed.slice(0, 4000) };
	}
}

function stripBom(text: string): string {
	// UTF-8 BOM decoded as U+FEFF. Also strip UTF-16 BOMs if a host mis-decodes.
	if (
		text.charCodeAt(0) === 0xfeff ||
		text.charCodeAt(0) === 0xfffe
	) {
		return text.slice(1);
	}
	return text;
}

/**
 * Build a client-connectable HTTP origin from server settings.
 * Bind wildcards (`0.0.0.0` / `::`) are not routable as clients; IPv6 literals
 * need brackets in URLs.
 */
export function clientConnectOrigin(host: string, port: number): string {
	let h = host.trim();
	if (!h || h === "0.0.0.0" || h === "::" || h === "[::]") {
		h = "127.0.0.1";
	} else if (h.includes(":") && !h.startsWith("[")) {
		h = `[${h}]`;
	}
	return `http://${h}:${port}`;
}
