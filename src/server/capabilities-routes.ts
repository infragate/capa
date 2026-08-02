import type { ArrayCapabilitySection } from "../shared/capabilities";
import { extractAllVariables } from "../shared/variable-resolver";
import type { Capabilities } from "../types/capabilities";
import {
	handleAppend,
	handleDelete,
	handleReorder,
	handleUpdate,
} from "./capabilities-mutations";
import {
	type CapabilitiesRouteDeps,
	type ConfigureAfterWrite,
	isArrayCapabilitySection,
} from "./capabilities-route-helpers";
import {
	handleFromRegistry,
	handlePatchOptions,
	handlePutAgents,
} from "./capabilities-special-routes";

export type { CapabilitiesRouteDeps, ConfigureAfterWrite };
export { isArrayCapabilitySection };

/**
 * Route dispatcher for `/api/projects/:id/capabilities…` mutations.
 * Returns null if the path is not a capabilities mutation route.
 */
export async function handleCapabilitiesMutation(
	deps: CapabilitiesRouteDeps,
	projectId: string,
	path: string,
	method: string,
	request: Request,
): Promise<Response | null> {
	const base = `/api/projects/${projectId}/capabilities`;
	if (!path.startsWith(base)) return null;

	const rest = path.slice(base.length);

	// PATCH /capabilities/options
	if (rest === "/options" && method === "PATCH") {
		return handlePatchOptions(deps, projectId, request);
	}

	// PUT /capabilities/agents — replace or clear the agents object
	if (rest === "/agents" && method === "PUT") {
		return handlePutAgents(deps, projectId, request);
	}

	// POST /capabilities/skills/from-registry
	if (rest === "/skills/from-registry" && method === "POST") {
		return handleFromRegistry(deps, projectId, request, "skills");
	}

	// POST /capabilities/plugins/from-registry
	if (rest === "/plugins/from-registry" && method === "POST") {
		return handleFromRegistry(deps, projectId, request, "plugins");
	}

	// POST /capabilities/:section
	const postMatch = rest.match(
		/^\/(skills|servers|tools|plugins|subagents|rules|hooks)$/,
	);
	if (postMatch && method === "POST") {
		return handleAppend(
			deps,
			projectId,
			postMatch[1] as ArrayCapabilitySection,
			request,
		);
	}

	// PUT /capabilities/:section/order
	const orderMatch = rest.match(
		/^\/(skills|servers|tools|plugins|subagents|rules|hooks)\/order$/,
	);
	if (orderMatch && method === "PUT") {
		return handleReorder(
			deps,
			projectId,
			orderMatch[1] as ArrayCapabilitySection,
			request,
		);
	}

	// PATCH|DELETE /capabilities/:section/:entryId
	const entryMatch = rest.match(
		/^\/(skills|servers|tools|plugins|subagents|rules|hooks)\/([^/]+)$/,
	);
	if (entryMatch) {
		const section = entryMatch[1] as ArrayCapabilitySection;
		const entryIdParam = decodeURIComponent(entryMatch[2]);
		if (method === "PATCH") {
			return handleUpdate(deps, projectId, section, entryIdParam, request);
		}
		if (method === "DELETE") {
			return handleDelete(deps, projectId, section, entryIdParam, request);
		}
	}

	return null;
}

/** Variable catalog helpers used by the server. */
const INTERNAL_OAUTH_VAR = /^oauth2_client_(id|secret)_/;

export function buildVariablesResponse(
	capabilities: Capabilities | null,
	values: Record<string, string>,
): { required: string[]; catalog: string[]; values: Record<string, string> } {
	const required = (
		capabilities ? extractAllVariables(capabilities) : []
	).filter((name) => !INTERNAL_OAUTH_VAR.test(name));
	const catalog = Object.keys(values)
		.filter((name) => !INTERNAL_OAUTH_VAR.test(name))
		.sort();
	const publicValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (!INTERNAL_OAUTH_VAR.test(key)) publicValues[key] = value;
	}
	return { required, catalog, values: publicValues };
}
