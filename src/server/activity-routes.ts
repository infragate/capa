import { detectCapabilitiesFile } from "../shared/paths";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { isAgentActivityEnabled } from "../shared/agent-activity";
import { syncSystemActivityHooks } from "../shared/agent-activity-sync";
import { resolveProvidersForClean } from "../shared/providers/resolve";
import type { ToolCallKind, ToolCallStatus } from "../types/database";
import type { ToolCallTracer } from "./tool-call-tracer";
import { type ProjectRouteDeps } from "./project-routes";

const JSON_HEADERS = { "Content-Type": "application/json" };

const ALLOWED_KINDS = new Set<ToolCallKind>([
	"setup_tools",
	"call_tool",
	"tool",
	"prompt",
	"shell",
	"file",
	"skill",
	"session",
	"subagent",
	"compact",
	"stop",
	"agent_mcp",
	"agent_tool",
]);

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
	try {
		const file = await detectCapabilitiesFile(projectPath);
		if (file) {
			const disk = await parseCapabilitiesFile(file.path, file.format);
			return isAgentActivityEnabled(disk.options);
		}
	} catch {
		/* fall through */
	}
	const caps = deps.sessionManager.getProjectCapabilities(projectId);
	return isAgentActivityEnabled(caps?.options);
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
	const providers = resolveProvidersForClean({
		capabilitiesProviders: capabilities.providers,
		db: deps.db,
		projectId,
	});
	if (providers.length === 0) {
		return new Response(
			JSON.stringify({
				success: true,
				enabled: isAgentActivityEnabled(capabilities.options),
				installed: 0,
				removed: 0,
				warnings: ["No providers configured — nothing to sync"],
			}),
			{ headers: JSON_HEADERS },
		);
	}

	try {
		const result = await syncSystemActivityHooks({
			projectPath: project.path,
			projectId,
			capabilitiesFilePath: file.path,
			capabilities,
			providers,
			db: deps.db,
		});

		const liveCaps = deps.sessionManager.getProjectCapabilities(projectId);
		if (liveCaps) {
			liveCaps.options = {
				...liveCaps.options,
				...capabilities.options,
			};
			deps.sessionManager.setProjectCapabilities(projectId, liveCaps);
		}

		return new Response(
			JSON.stringify({
				success: true,
				enabled: result.enabled,
				installed: result.installed,
				removed: result.removed,
				warnings: result.warnings,
			}),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}
