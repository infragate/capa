import { detectCapabilitiesFile } from "../shared/paths";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { isAgentActivityEnabled } from "../shared/agent-activity";
import { syncSystemActivityHooks } from "../shared/agent-activity-sync";
import { resolveProvidersForClean } from "../shared/providers/resolve";
import { TOOL_CALL_KINDS, type ToolCallKind, type ToolCallStatus } from "../types/database";
import type { ToolCallTracer } from "./tool-call-tracer";
import { type ProjectRouteDeps } from "./project-routes";

const JSON_HEADERS = { "Content-Type": "application/json" };

const ALLOWED_KINDS = new Set<ToolCallKind>(TOOL_CALL_KINDS);

export interface ActivityIngestBody {
	kind?: string;
	toolName?: string;
	status?: string;
	source?: string | null;
	args?: unknown;
	resultPreview?: unknown;
	errorMessage?: string | null;
	sessionId?: string | null;
	agentId?: string | null;
}

async function resolveAgentActivityEnabled(
	deps: ProjectRouteDeps,
	projectId: string,
	projectPath: string,
): Promise<boolean> {
	// Prefer in-memory session caps (updated by configure / file watcher).
	// Avoid disk I/O + YAML parse on every high-frequency ingest event.
	try {
		const live = deps.sessionManager.getProjectCapabilities(projectId);
		if (live) return isAgentActivityEnabled(live.options);
	} catch {
		/* fall through */
	}
	try {
		const file = await detectCapabilitiesFile(projectPath);
		if (file) {
			const disk = await parseCapabilitiesFile(file.path, file.format);
			return isAgentActivityEnabled(disk.options);
		}
	} catch {
		/* fail-open to enabled default */
	}
	return isAgentActivityEnabled(undefined);
}

export async function handlePostProjectActivityEvent(
	deps: ProjectRouteDeps & { toolCallTracer: ToolCallTracer },
	projectId: string,
	request: Request,
): Promise<Response> {
	const project = deps.db.getProject(projectId);
	if (!project) {
		return new Response(JSON.stringify({ error: "Project not found" }), {
			status: 404,
			headers: JSON_HEADERS,
		});
	}

	if (!(await resolveAgentActivityEnabled(deps, projectId, project.path))) {
		return new Response(null, { status: 204 });
	}

	let body: ActivityIngestBody;
	try {
		body = (await request.json()) as ActivityIngestBody;
	} catch {
		return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}

	const kind = body.kind as ToolCallKind | undefined;
	const toolName =
		typeof body.toolName === "string" && body.toolName.trim()
			? body.toolName.trim()
			: null;
	if (!kind || !ALLOWED_KINDS.has(kind) || !toolName) {
		return new Response(
			JSON.stringify({ error: "kind and toolName are required" }),
			{ status: 400, headers: JSON_HEADERS },
		);
	}

	const status: ToolCallStatus =
		body.status === "error" || body.status === "running"
			? body.status
			: "ok";

	const id = deps.toolCallTracer.start({
		projectId,
		sessionId: body.sessionId ?? null,
		agentId: body.agentId ?? null,
		source: body.source ?? null,
		kind,
		toolName,
		args: body.args,
	});

	// Tracer finish already notifies SSE via ToolCallTracer constructor notify.
	deps.toolCallTracer.finish(id, {
		status: status === "running" ? "ok" : status,
		resultPreview: body.resultPreview,
		errorMessage: body.errorMessage ?? null,
	});

	return new Response(JSON.stringify({ ok: true, id }), {
		status: 201,
		headers: JSON_HEADERS,
	});
}

export async function handleSyncActivityHooks(
	deps: ProjectRouteDeps,
	projectId: string,
): Promise<Response> {
	const project = deps.db.getProject(projectId);
	if (!project) {
		return new Response(JSON.stringify({ error: "Project not found" }), {
			status: 404,
			headers: JSON_HEADERS,
		});
	}

	const file = await detectCapabilitiesFile(project.path);
	if (!file) {
		return new Response(
			JSON.stringify({ error: "Capabilities file not found" }),
			{ status: 404, headers: JSON_HEADERS },
		);
	}

	const capabilities = await parseCapabilitiesFile(file.path, file.format);
	let providers = resolveProvidersForClean({
		capabilitiesProviders: capabilities.providers,
		db: deps.db,
		projectId,
	});
	// When the capabilities file / DB have no providers (common after wrap with
	// persistProviders=false), still sync against providers that already have
	// managed hooks so pruneOrphanHooks can remove stale capa-sys-activity entries.
	if (providers.length === 0) {
		providers = [
			...new Set(
				deps.db.getManagedHooks(projectId).map((row) => row.providerId),
			),
		];
	}

	try {
		const result = await syncSystemActivityHooks({
			projectPath: project.path,
			projectId,
			capabilitiesFilePath: file.path,
			capabilities,
			providers,
			db: deps.db,
			quiet: true,
		});

		const liveCaps = deps.sessionManager.getProjectCapabilities(projectId);
		if (liveCaps) {
			liveCaps.options = {
				...liveCaps.options,
				...capabilities.options,
			};
			deps.sessionManager.setProjectCapabilities(projectId, liveCaps);
		}

		const warnings = [...result.warnings];
		if (providers.length === 0) {
			warnings.push("No providers configured — pruned managed hooks only");
		}

		return new Response(
			JSON.stringify({
				success: true,
				enabled: result.enabled,
				installed: result.installed,
				removed: result.removed,
				warnings,
			}),
			{ headers: JSON_HEADERS },
		);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}
