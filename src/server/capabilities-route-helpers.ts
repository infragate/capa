import type { CapaDatabase } from "../db/database";
import type { ArrayCapabilitySection } from "../shared/capabilities";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { detectCapabilitiesFile } from "../shared/paths";
import type { RegistryManager } from "../shared/registries/manager";
import type { Capabilities, CapabilitiesFormat } from "../types/capabilities";

const JSON_HEADERS = { "Content-Type": "application/json" };

export const ARRAY_SECTIONS = new Set<ArrayCapabilitySection>([
	"skills",
	"servers",
	"tools",
	"plugins",
	"subagents",
	"rules",
	"hooks",
]);

export function jsonError(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: JSON_HEADERS,
	});
}

export function jsonOk(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export type ConfigureAfterWrite = (
	projectId: string,
	capabilities: Capabilities,
) => Promise<Record<string, unknown>>;

/** Update session cache after reorder without OAuth/tool validation. */
export type RefreshAfterReorder = (
	projectId: string,
	capabilities: Capabilities,
) => Promise<Record<string, unknown>>;

export interface CapabilitiesRouteDeps {
	db: CapaDatabase;
	registryManager: RegistryManager;
	configure: ConfigureAfterWrite;
	/** Light path used by reorder — skips MCP validation / OAuth probes. */
	refreshCapabilities?: RefreshAfterReorder;
	/** Called around capa-owned file writes so the disk watcher can ignore them. */
	markSelfWrite?: (projectId: string) => void;
	/** Notify live UI clients after a successful write+configure. */
	notifyChanged?: (projectId: string) => void;
}

export async function resolveCapabilitiesFile(projectPath: string): Promise<{
	path: string;
	format: CapabilitiesFormat;
} | null> {
	return detectCapabilitiesFile(projectPath);
}

export async function loadProjectFile(
	db: CapaDatabase,
	projectId: string,
): Promise<
	| {
			ok: true;
			projectPath: string;
			path: string;
			format: CapabilitiesFormat;
			caps: Capabilities;
	  }
	| { ok: false; response: Response }
> {
	const project = db.getProject(projectId);
	if (!project) {
		return { ok: false, response: jsonError("Project not found", 404) };
	}
	const file = await resolveCapabilitiesFile(project.path);
	if (!file) {
		return {
			ok: false,
			response: jsonError(
				"No capabilities.yaml or capabilities.json found in project",
				404,
			),
		};
	}
	const caps = await parseCapabilitiesFile(file.path, file.format);
	return {
		ok: true,
		projectPath: project.path,
		path: file.path,
		format: file.format,
		caps,
	};
}

export async function afterWrite(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	path: string,
	format: CapabilitiesFormat,
): Promise<Response> {
	deps.markSelfWrite?.(projectId);
	const caps = await parseCapabilitiesFile(path, format);
	const configureResult = await deps.configure(projectId, caps);
	deps.notifyChanged?.(projectId);
	return jsonOk({
		success: true,
		...configureResult,
	});
}

/**
 * After reordering a section: refresh the in-memory capabilities cache only.
 * Full configure (OAuth detection + validating every tool against MCP servers)
 * is unnecessary for order changes and can stall or drop the HTTP response on
 * large projects.
 */
export async function afterReorderWrite(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	path: string,
	format: CapabilitiesFormat,
): Promise<Response> {
	deps.markSelfWrite?.(projectId);
	const caps = await parseCapabilitiesFile(path, format);
	const refresh = deps.refreshCapabilities ?? deps.configure;
	const result = await refresh(projectId, caps);
	// Do not broadcast capabilities-changed — that invalidates server-tools for
	// every client and stampedes MCP list_tools. The mutating UI already applied
	// an optimistic reorder and will refetch the project document.
	return jsonOk({
		success: true,
		...result,
	});
}

export function entryId(entry: Record<string, unknown>): string | undefined {
	return typeof entry.id === "string" ? entry.id : undefined;
}

export function findById(
	caps: Capabilities,
	section: ArrayCapabilitySection,
	id: string,
): unknown {
	const list = (caps as unknown as Record<string, unknown>)[section];
	if (!Array.isArray(list)) return undefined;
	return list.find((item) => asObj(item)?.id === id);
}

export function asObj(value: unknown): Record<string, unknown> | null {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

export function isPluginSourced(entry: unknown): boolean {
	const obj = asObj(entry);
	return !!obj?.sourcePlugin;
}

export function isArrayCapabilitySection(
	value: string,
): value is ArrayCapabilitySection {
	return ARRAY_SECTIONS.has(value as ArrayCapabilitySection);
}
