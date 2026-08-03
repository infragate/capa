import { cleanProject } from "../cli/commands/clean-project";
import type { CapaDatabase } from "../db/database";
import { isSystemActivityHookId } from "../shared/agent-activity";
import { parseCapabilitiesFile } from "../shared/capabilities";
import { detectCapabilitiesFile } from "../shared/paths";
import { isUnderWrapWorkspacesDir } from "../shared/workspaces/paths";
import type {
	Capabilities,
	MCPServer,
	ToolCommandDefinition,
	ToolMCPDefinition,
} from "../types/capabilities";
import type { ToolCallRecord } from "../types/database";
import type { CapabilitiesFileWatcher } from "./capabilities-watcher";
import type { ConfigureRouteDeps } from "./configure-routes";
import { runProjectConfigure } from "./configure-routes";
import type { CapaMCPServer } from "./mcp-handler";
import { OAuth2Manager } from "./oauth-manager";
import { listProjectFs, writeProjectImport } from "./project-fs";
import { clientErrorMessage } from "./http-error";
import {
	type EffectiveCapsCacheEntry,
	loadEffectiveCapabilities,
	preserveDiscoveredOAuth2,
} from "./resolve-effective-capabilities";
import type { SessionManager } from "./session-manager";
import {
	resolveSkillDescription,
	resolveSkillSourceUrl,
} from "./skill-content";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface ProjectRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
	oauth2Manager: OAuth2Manager;
	capsWatcher: CapabilitiesFileWatcher;
	effectiveCapsCache: Map<string, EffectiveCapsCacheEntry>;
	projectEventClients: Map<string, Set<(chunk: Uint8Array) => void>>;
	configureDeps: ConfigureRouteDeps;
}

export async function handleGetProjects(
	deps: ProjectRouteDeps,
): Promise<Response> {
	try {
		const projects = deps.db
			.getAllProjects()
			.filter((project) => !isUnderWrapWorkspacesDir(project.path));

		const enrichedProjects = projects.map((project) => {
			const capabilities = deps.sessionManager.getProjectCapabilities(
				project.id,
			);
			return {
				id: project.id,
				path: project.path,
				created_at: project.created_at,
				updated_at: project.updated_at,
				skills_count: capabilities?.skills?.length || 0,
				tools_count: capabilities?.tools?.length || 0,
				servers_count: capabilities?.servers?.length || 0,
			};
		});

		return new Response(JSON.stringify({ projects: enrichedProjects }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleGetProject(
	deps: ProjectRouteDeps,
	projectId: string,
): Promise<Response> {
	try {
		const project = deps.db.getProject(projectId);
		if (!project) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		let capabilities = deps.sessionManager.getProjectCapabilities(projectId);
		try {
			const file = await detectCapabilitiesFile(project.path);
			if (file) {
				const authored = await parseCapabilitiesFile(file.path, file.format);
				const previous = deps.sessionManager.getProjectCapabilities(projectId);
				capabilities = preserveDiscoveredOAuth2(
					await loadEffectiveCapabilities(
						authored,
						project.path,
						projectId,
						file.path,
						deps.db,
						deps.effectiveCapsCache,
					),
					previous,
				);
				deps.sessionManager.setProjectCapabilities(projectId, capabilities);
				void deps.capsWatcher.watchProject(projectId, project.path);
			}
		} catch {
			// ignore unreadable capabilities file; keep cached capabilities if any
		}

		const installedHooksByHookId = new Map<
			string,
			{ providerId: string; configPath: string; scriptPath: string | null }[]
		>();
		if (capabilities && (capabilities.hooks || []).length > 0) {
			for (const m of deps.db.getManagedHooks(projectId)) {
				const list = installedHooksByHookId.get(m.hookId);
				const entry = {
					providerId: m.providerId,
					configPath: m.configPath,
					scriptPath: m.scriptPath,
				};
				if (list) list.push(entry);
				else installedHooksByHookId.set(m.hookId, [entry]);
			}
		}

		const projectDetails = {
			id: project.id,
			path: project.path,
			created_at: project.created_at,
			updated_at: project.updated_at,
			capabilities: capabilities
				? {
						skills: capabilities.skills.map((s) => {
							const { description, descriptionSource } =
								resolveSkillDescription(
									project.path,
									s,
									capabilities.providers || [],
									{ projectId },
								);
							return {
								id: s.id,
								type: s.type,
								description,
								descriptionSource,
								requires: s.def?.requires || [],
								content: s.type === "inline" ? s.def?.content || null : null,
								path: s.type === "local" ? s.def?.path || null : null,
								sourcePlugin: s.sourcePlugin || null,
								sourceUrl: resolveSkillSourceUrl(
									s,
									capabilities.resolvedPlugins,
								),
							};
						}),
						tools: capabilities.tools.map((t) => {
							const base: Record<string, any> = {
								id: t.id,
								type: t.type,
								description: t.description || null,
								sourcePlugin: t.sourcePlugin || null,
							};
							if (t.type === "mcp") {
								const mcpDef = t.def as ToolMCPDefinition;
								base.mcpServer = mcpDef.server;
								base.mcpTool = mcpDef.tool;
								base.defaults = mcpDef.defaults || null;
								base.formatter = mcpDef.formatter
									? {
											cmd: mcpDef.formatter.cmd,
											timeout: mcpDef.formatter.timeout,
										}
									: null;
							} else if (t.type === "command") {
								const cmdDef = t.def as ToolCommandDefinition;
								base.command = cmdDef.run.cmd;
								base.commandArgs = cmdDef.run.args || [];
								if (t.group) base.group = t.group;
							}
							return base;
						}),
						servers: capabilities.servers.map((s) => {
							const requiresOAuth = !!s.def?.oauth2;
							const isConnected = requiresOAuth
								? deps.oauth2Manager.isServerConnected(projectId, s.id)
								: null;
							return {
								id: s.id,
								type: s.type,
								url: s.def?.url || null,
								cmd: s.def?.cmd || null,
								args: s.def?.args || null,
								env: s.def?.env || null,
								headers: s.def?.headers || null,
								cwd: s.def?.cwd || null,
								tlsSkipVerify: s.def?.tlsSkipVerify === true,
								oauth2: s.def?.oauth2
									? {
											clientId:
												s.def.oauth2.clientId ??
												s.def.oauth2.client_id ??
												s.def.oauth2.oauth?.clientId ??
												null,
											clientSecret: s.def.oauth2.clientSecret ?? null,
											authorizationUrl:
												s.def.oauth2.authorizationUrl ??
												s.def.oauth2.authorizationEndpoint ??
												null,
											tokenUrl:
												s.def.oauth2.tokenUrl ??
												s.def.oauth2.tokenEndpoint ??
												null,
											scopes:
												s.def.oauth2.scopes ??
												(s.def.oauth2.scope ? [s.def.oauth2.scope] : null),
											redirectUri: s.def.oauth2.redirectUri ?? null,
											pkce: s.def.oauth2.pkce === true,
										}
									: null,
								sourcePlugin: s.sourcePlugin || null,
								displayName: s.displayName || null,
								description: s.description || null,
								requiresOAuth,
								isConnected,
							};
						}),
						resolvedPlugins: capabilities.resolvedPlugins || null,
						providers: capabilities.providers || [],
						subagents: (capabilities.subagents || []).map((sa) => ({
							id: sa.id,
							description: sa.description || null,
							skills: sa.skills,
							tools: sa.tools,
							instructions: sa.instructions || null,
							sourcePlugin: sa.sourcePlugin || null,
						})),
						rules: (capabilities.rules || []).map((r) => ({
							id: r.id,
							type: r.type,
							description: r.description || null,
							providers: r.providers || [],
							appliesTo: r.appliesTo || [],
							alwaysApply: r.alwaysApply || false,
							content: r.type === "inline" ? r.content || null : null,
							url: r.url || null,
							path: r.path || null,
							def: r.def || null,
							sourcePlugin: r.sourcePlugin || null,
						})),
						hooks: (capabilities.hooks || [])
							.filter((h) => !isSystemActivityHookId(h.id))
							.map((h) => ({
							id: h.id,
							description: h.description || null,
							on: h.on,
							type: h.type || "command",
							providers: h.providers || [],
							matcher: h.matcher || null,
							timeout: h.timeout ?? null,
							failClosed: h.failClosed ?? false,
							sequential: h.sequential ?? false,
							sourceType: h.source?.type || null,
							command: h.command ?? null,
							prompt: h.prompt ?? null,
							sourceContent:
								h.source?.type === "inline" &&
								typeof (h.source as { content?: unknown }).content === "string"
									? (h.source as { content: string }).content
									: null,
							installed: installedHooksByHookId.get(h.id) ?? [],
							sourcePlugin: h.sourcePlugin || null,
						})),
						plugins: (capabilities.plugins || []).map((p) => ({
							id: p.id || null,
							type: p.type,
							def: p.def,
						})),
						agents: capabilities.agents
							? {
									base: capabilities.agents.base
										? {
												type: capabilities.agents.base.type || null,
												ref: capabilities.agents.base.ref || null,
												path: capabilities.agents.base.path || null,
												def: capabilities.agents.base.def || null,
											}
										: null,
									additional: (capabilities.agents.additional || []).map(
										(snip) => ({
											id: snip.id || null,
											type: snip.type,
											content:
												snip.type === "inline" ? snip.content || null : null,
											url: snip.url || null,
											path: snip.path || null,
											def: snip.def || null,
										}),
									),
								}
							: null,
						options: capabilities.options
							? {
									toolExposure: capabilities.options.toolExposure || null,
									agentActivity:
										capabilities.options.agentActivity !== false,
									security: capabilities.options.security
										? {
												blockedPhrases:
													capabilities.options.security.blockedPhrases || [],
												allowedCharacters:
													capabilities.options.security.allowedCharacters ||
													null,
											}
										: null,
									requiresCommands: (
										capabilities.options.requiresCommands || []
									).map((c) => ({
										cli: c.cli,
										description: c.description || null,
									})),
								}
							: null,
					}
				: null,
		};

		return new Response(JSON.stringify(projectDetails), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleDeleteProject(
	deps: ProjectRouteDeps,
	projectId: string,
): Promise<Response> {
	try {
		const project = deps.db.getProject(projectId);
		if (!project) {
			return new Response(JSON.stringify({ error: "Project not found" }), {
				status: 404,
				headers: JSON_HEADERS,
			});
		}

		if (isUnderWrapWorkspacesDir(project.path)) {
			return new Response(
				JSON.stringify({
					error: "Refusing to delete a wrap workspace shadow path",
				}),
				{ status: 400, headers: JSON_HEADERS },
			);
		}

		const result = await cleanProject({
			projectPath: project.path,
			projectId,
			db: deps.db,
		});

		deps.capsWatcher.unwatchProject(projectId);
		deps.sessionManager.clearProjectCapabilities(projectId);
		deps.effectiveCapsCache.delete(projectId);

		return new Response(
			JSON.stringify({
				success: true,
				wrapSessionsStopped: result.wrapSessionsStopped,
				workspacesPruned: result.workspacesPruned,
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

export async function handleProjectFsList(
	deps: ProjectRouteDeps,
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
	const url = new URL(request.url);
	const rel = url.searchParams.get("path") || "";
	const ext = url.searchParams.get("ext") || undefined;
	const dirsOnly = url.searchParams.get("dirsOnly") === "true";
	try {
		const result = listProjectFs(project.path, rel, { ext, dirsOnly });
		return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
	} catch (err: unknown) {
		return new Response(
			JSON.stringify({ error: clientErrorMessage(err, "Invalid path") }),
			{ status: 400, headers: JSON_HEADERS },
		);
	}
}

export async function handleProjectFsUpload(
	deps: ProjectRouteDeps,
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
	try {
		const form = await request.formData();
		const file = form.get("file");
		if (!(file instanceof File)) {
			return new Response(JSON.stringify({ error: "Missing file field" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}
		if (file.size === 0) {
			return new Response(JSON.stringify({ error: "Empty file" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}
		if (file.size > 2 * 1024 * 1024) {
			return new Response(
				JSON.stringify({ error: "File too large (max 2 MiB)" }),
				{ status: 400, headers: JSON_HEADERS },
			);
		}
		const asSkillDir = String(form.get("asSkillDir") || "") === "true";
		const subdir = form.get("subdir");
		const bytes = new Uint8Array(await file.arrayBuffer());
		const written = writeProjectImport(project.path, {
			filename: file.name || "upload.md",
			bytes,
			subdir: typeof subdir === "string" && subdir ? subdir : undefined,
			asSkillDir,
		});
		return new Response(JSON.stringify(written), { headers: JSON_HEADERS });
	} catch (err: unknown) {
		return new Response(
			JSON.stringify({
				error: clientErrorMessage(err, "Upload failed"),
			}),
			{ status: 400, headers: JSON_HEADERS },
		);
	}
}

export function notifyProjectChanged(
	projectEventClients: Map<string, Set<(chunk: Uint8Array) => void>>,
	projectId: string,
): void {
	const clients = projectEventClients.get(projectId);
	if (!clients || clients.size === 0) return;
	const encoder = new TextEncoder();
	const chunk = encoder.encode(
		`event: capabilities-changed\ndata: ${JSON.stringify({ projectId, at: Date.now() })}\n\n`,
	);
	for (const send of [...clients]) {
		try {
			send(chunk);
		} catch {
			clients.delete(send);
		}
	}
}

export function notifyToolCall(
	projectEventClients: Map<string, Set<(chunk: Uint8Array) => void>>,
	projectId: string,
	record: ToolCallRecord,
): void {
	const clients = projectEventClients.get(projectId);
	if (!clients || clients.size === 0) return;
	const encoder = new TextEncoder();
	const chunk = encoder.encode(
		`event: tool-call\ndata: ${JSON.stringify(record)}\n\n`,
	);
	for (const send of [...clients]) {
		try {
			send(chunk);
		} catch {
			clients.delete(send);
		}
	}
}

export function handleGetProjectActivity(
	deps: ProjectRouteDeps,
	projectId: string,
	limitParam: string | null,
	beforeParam: string | null = null,
	beforeIdParam: string | null = null,
): Response {
	const project = deps.db.getProject(projectId);
	if (!project) {
		return new Response(JSON.stringify({ error: "Project not found" }), {
			status: 404,
			headers: JSON_HEADERS,
		});
	}
	const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 50;
	const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
	const parsedBefore = beforeParam ? Number.parseInt(beforeParam, 10) : NaN;
	const beforeStartedAt = Number.isFinite(parsedBefore) ? parsedBefore : null;
	const beforeId = beforeIdParam?.trim() ? beforeIdParam.trim() : null;
	const page = deps.db.listToolCalls(projectId, {
		limit,
		beforeStartedAt,
		beforeId,
		before: beforeStartedAt,
	});
	return new Response(JSON.stringify(page), { headers: JSON_HEADERS });
}

export function handleGetProjectActivityStats(
	deps: ProjectRouteDeps,
	projectId: string,
): Response {
	const project = deps.db.getProject(projectId);
	if (!project) {
		return new Response(JSON.stringify({ error: "Project not found" }), {
			status: 404,
			headers: JSON_HEADERS,
		});
	}
	const stats = deps.db.getToolCallStats(projectId);
	return new Response(JSON.stringify(stats), { headers: JSON_HEADERS });
}

export async function reloadProjectCapabilitiesFromDisk(
	deps: ProjectRouteDeps,
	projectId: string,
): Promise<void> {
	const project = deps.db.getProject(projectId);
	if (!project) return;
	const file = await detectCapabilitiesFile(project.path);
	if (!file) {
		notifyProjectChanged(deps.projectEventClients, projectId);
		return;
	}
	const caps = await parseCapabilitiesFile(file.path, file.format);
	await runProjectConfigure(deps.configureDeps, projectId, caps);
	notifyProjectChanged(deps.projectEventClients, projectId);
}

export function handleProjectEvents(
	deps: ProjectRouteDeps,
	projectId: string,
): Response {
	const project = deps.db.getProject(projectId);
	if (!project) {
		return new Response(JSON.stringify({ error: "Project not found" }), {
			status: 404,
			headers: JSON_HEADERS,
		});
	}

	void deps.capsWatcher.watchProject(projectId, project.path);

	const encoder = new TextEncoder();
	let send: ((chunk: Uint8Array) => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start: (controller) => {
			send = (chunk) => {
				try {
					controller.enqueue(chunk);
				} catch {
					throw new Error("sse client closed");
				}
			};
			let set = deps.projectEventClients.get(projectId);
			if (!set) {
				set = new Set();
				deps.projectEventClients.set(projectId, set);
			}
			set.add(send);
			controller.enqueue(
				encoder.encode(
					`event: capabilities-changed\ndata: ${JSON.stringify({ projectId, at: Date.now(), reason: "connected" })}\n\n`,
				),
			);
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
				} catch {
					if (heartbeat) clearInterval(heartbeat);
				}
			}, 15000);
		},
		cancel: () => {
			if (heartbeat) clearInterval(heartbeat);
			if (!send) return;
			const set = deps.projectEventClients.get(projectId);
			set?.delete(send);
			if (set && set.size === 0) deps.projectEventClients.delete(projectId);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
