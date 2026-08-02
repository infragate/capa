import type { ArrayCapabilitySection } from "../shared/capabilities";
import {
	appendCapabilityEntry,
	parseCapabilitiesFile,
	removeCapabilityEntry,
	reorderCapabilityEntries,
	updateCapabilityEntry,
} from "../shared/capabilities";
import {
	afterReorderWrite,
	afterWrite,
	asObj,
	type CapabilitiesRouteDeps,
	entryId,
	findById,
	isPluginSourced,
	jsonError,
	loadProjectFile,
} from "./capabilities-route-helpers";
import { clientErrorMessage } from "./http-error";

export async function handleAppend(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	section: ArrayCapabilitySection,
	request: Request,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const id = entryId(body);
	if (!id) {
		return jsonError('Entry must include a string "id"', 400);
	}

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	if (findById(loaded.caps, section, id)) {
		return jsonError(
			`${section.slice(0, -1)} with id "${id}" already exists`,
			409,
		);
	}

	try {
		await appendCapabilityEntry(loaded.path, loaded.format, section, body);
		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function handleReorder(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	section: ArrayCapabilitySection,
	request: Request,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const ids = body.ids;
	if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
		return jsonError('Body must include an "ids" array of strings', 400);
	}

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	try {
		// Mark before the write so the disk watcher ignores our own mtime bump.
		deps.markSelfWrite?.(projectId);
		await reorderCapabilityEntries(
			loaded.path,
			loaded.format,
			section,
			ids as string[],
		);
		return await afterReorderWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function handleUpdate(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	section: ArrayCapabilitySection,
	id: string,
	request: Request,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	const existing = findById(loaded.caps, section, id);
	if (!existing) {
		return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
	}
	if (
		isPluginSourced(existing) &&
		(section === "skills" ||
			section === "servers" ||
			section === "rules" ||
			section === "hooks" ||
			section === "subagents")
	) {
		return jsonError(
			`Cannot edit plugin-sourced ${section.slice(0, -1)}; remove the plugin instead`,
			400,
		);
	}

	const nextId = typeof body.id === "string" ? body.id : id;
	if (nextId !== id && findById(loaded.caps, section, nextId)) {
		return jsonError(
			`${section.slice(0, -1)} with id "${nextId}" already exists`,
			409,
		);
	}

	try {
		const updated = await updateCapabilityEntry(
			loaded.path,
			loaded.format,
			section,
			(e) => e.id === id,
			(e) => {
				const merged = { ...e, ...body, id: nextId } as Record<
					string,
					unknown
				> & {
					id: string;
				};
				if (asObj(body.def)) {
					if (section === "servers") {
						merged.def = asObj(body.def)!;
					} else if (asObj(merged.def)) {
						merged.def = { ...asObj(merged.def)!, ...asObj(body.def)! };
					}
				}
				return merged;
			},
		);
		if (!updated) {
			return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
		}

		// When renaming a server, cascade id updates into tool def.server refs
		if (section === "servers" && nextId !== id) {
			const capsAfter = await parseCapabilitiesFile(loaded.path, loaded.format);
			for (const tool of capsAfter.tools || []) {
				const def = asObj(tool.def);
				if (!def) continue;
				const serverRef = typeof def.server === "string" ? def.server : "";
				const bare = serverRef.replace(/^@/, "");
				if (bare !== id) continue;
				await updateCapabilityEntry(
					loaded.path,
					loaded.format,
					"tools",
					(e) => e.id === tool.id,
					(e) => {
						const d = asObj(e.def) ?? {};
						return {
							...e,
							def: {
								...d,
								server: serverRef.startsWith("@") ? `@${nextId}` : nextId,
							},
						};
					},
				);
			}
		}

		// When renaming a tool, cascade id updates into skill.requires and subagent.tools
		if (section === "tools" && nextId !== id) {
			const capsAfter = await parseCapabilitiesFile(loaded.path, loaded.format);
			const rewriteRef = (ref: string): string => {
				if (ref === id) return nextId;
				const at = ref.startsWith("@");
				const stripped = at ? ref.slice(1) : ref;
				if (stripped.endsWith(`.${id}`)) {
					return `${at ? "@" : ""}${stripped.slice(0, -id.length)}${nextId}`;
				}
				return ref;
			};
			for (const skill of capsAfter.skills || []) {
				const requires = skill.def?.requires;
				if (
					!Array.isArray(requires) ||
					!requires.some((r) => rewriteRef(r) !== r)
				)
					continue;
				await updateCapabilityEntry(
					loaded.path,
					loaded.format,
					"skills",
					(e) => e.id === skill.id,
					(e) => {
						const def = asObj(e.def) ?? {};
						const req = Array.isArray(def.requires)
							? [...(def.requires as string[])]
							: [];
						return {
							...e,
							def: {
								...def,
								requires: req.map(rewriteRef),
							},
						};
					},
				);
			}
			for (const agent of capsAfter.subagents || []) {
				if (
					!Array.isArray(agent.tools) ||
					!agent.tools.some((r) => rewriteRef(r) !== r)
				)
					continue;
				await updateCapabilityEntry(
					loaded.path,
					loaded.format,
					"subagents",
					(e) => e.id === agent.id,
					(e) => {
						const tools = Array.isArray(e.tools)
							? [...(e.tools as string[])]
							: [];
						return {
							...e,
							tools: tools.map(rewriteRef),
						};
					},
				);
			}
		}

		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function handleDelete(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	section: ArrayCapabilitySection,
	id: string,
	request: Request,
): Promise<Response> {
	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	const existing = findById(loaded.caps, section, id);
	if (!existing) {
		return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
	}
	if (
		isPluginSourced(existing) &&
		(section === "skills" ||
			section === "servers" ||
			section === "rules" ||
			section === "hooks" ||
			section === "subagents")
	) {
		return jsonError(
			`Cannot delete plugin-sourced ${section.slice(0, -1)}; remove the plugin instead`,
			400,
		);
	}

	const url = new URL(request.url);
	const cascadeTools = url.searchParams.get("cascadeTools") === "true";

	try {
		const removed = await removeCapabilityEntry(
			loaded.path,
			loaded.format,
			section,
			(e) => e.id === id,
		);
		if (removed === 0) {
			return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
		}

		if (section === "servers" && cascadeTools) {
			await removeCapabilityEntry(loaded.path, loaded.format, "tools", (e) => {
				const def = asObj(e.def);
				if (!def || e.type !== "mcp") return false;
				const server =
					typeof def.server === "string" ? def.server.replace(/^@/, "") : "";
				return server === id;
			});
		}

		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}
