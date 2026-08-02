import type { OptionsPatch } from "../shared/capabilities";
import {
	appendCapabilityEntry,
	upsertAgents,
	upsertOptions,
} from "../shared/capabilities";
import type { AgentFileConfig, Skill } from "../types/capabilities";
import type { Plugin } from "../types/plugin";
import type { RegistryCapability } from "../types/registry";
import {
	afterWrite,
	type CapabilitiesRouteDeps,
	findById,
	jsonError,
	loadProjectFile,
} from "./capabilities-route-helpers";
import { clientErrorMessage } from "./http-error";

export async function handlePatchOptions(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	let body: OptionsPatch;
	try {
		body = (await request.json()) as OptionsPatch;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	try {
		await upsertOptions(loaded.path, loaded.format, body);
		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function handlePutAgents(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	let body: { agents?: AgentFileConfig | null };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	if (!("agents" in body)) {
		return jsonError(
			'Body must include an "agents" field (object or null)',
			400,
		);
	}

	const agents = body.agents;
	if (
		agents !== null &&
		(typeof agents !== "object" || Array.isArray(agents))
	) {
		return jsonError('"agents" must be an object or null', 400);
	}

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	try {
		await upsertAgents(loaded.path, loaded.format, agents ?? null);
		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}

export async function handleFromRegistry(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	request: Request,
	expectedCapability: RegistryCapability,
): Promise<Response> {
	let body: {
		registry?: string;
		itemId?: string;
		capability?: RegistryCapability;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const registryId = body.registry;
	const itemId = body.itemId;
	if (!registryId || !itemId) {
		return jsonError('Fields "registry" and "itemId" are required', 400);
	}

	const capability = body.capability ?? expectedCapability;

	const loaded = await loadProjectFile(deps.db, projectId);
	if (!loaded.ok) return loaded.response;

	try {
		const detail = await deps.registryManager.view(registryId, {
			capability,
			id: itemId,
		});
		const snippet = detail.installSnippet;
		const itemName =
			(snippet as { id?: string }).id ??
			itemId.split("/").pop() ??
			"registry-item";

		if (capability === "skills") {
			if (findById(loaded.caps, "skills", itemName)) {
				return jsonError(`Skill with id "${itemName}" already exists`, 409);
			}
			const newSkill: Skill = { ...(snippet as Skill), id: itemName };
			await appendCapabilityEntry(
				loaded.path,
				loaded.format,
				"skills",
				newSkill as unknown as Record<string, unknown>,
			);
		} else {
			if (findById(loaded.caps, "plugins", itemName)) {
				return jsonError(`Plugin with id "${itemName}" already exists`, 409);
			}
			const newPlugin = { ...(snippet as Plugin), id: itemName };
			await appendCapabilityEntry(
				loaded.path,
				loaded.format,
				"plugins",
				newPlugin as unknown as Record<string, unknown>,
			);
		}

		return await afterWrite(deps, projectId, loaded.path, loaded.format);
	} catch (err: any) {
		return jsonError(clientErrorMessage(err), 400);
	}
}
