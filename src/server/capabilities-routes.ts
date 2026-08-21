import type { ArrayCapabilitySection } from "../shared/capabilities";
import { secretHint } from "../shared/secret-crypto";
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
import { matchRoute } from "./match-route";

export type { CapabilitiesRouteDeps, ConfigureAfterWrite };
export { isArrayCapabilitySection };

const CAP_SECTION =
	":section(skills|servers|tools|plugins|subagents|rules|hooks)";

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
	const post = matchRoute(rest, `/${CAP_SECTION}`);
	if (post && method === "POST") {
		return handleAppend(
			deps,
			projectId,
			post.section as ArrayCapabilitySection,
			request,
		);
	}

	// PUT /capabilities/:section/order
	const order = matchRoute(rest, `/${CAP_SECTION}/order`);
	if (order && method === "PUT") {
		return handleReorder(
			deps,
			projectId,
			order.section as ArrayCapabilitySection,
			request,
		);
	}

	// PATCH|DELETE /capabilities/:section/:entryId
	const entry = matchRoute(rest, `/${CAP_SECTION}/:entryId`);
	if (entry) {
		const section = entry.section as ArrayCapabilitySection;
		if (method === "PATCH") {
			return handleUpdate(deps, projectId, section, entry.entryId, request);
		}
		if (method === "DELETE") {
			return handleDelete(deps, projectId, section, entry.entryId, request);
		}
	}

	return null;
}

/** Variable catalog helpers used by the server. */
const INTERNAL_OAUTH_VAR = /^oauth2_client_(id|secret)_/;

export function buildVariablesResponse(
	capabilities: Capabilities | null,
	values: Record<string, string>,
): {
	required: string[];
	catalog: string[];
	secrets: Array<{ name: string; isSet: boolean; hint: string }>;
} {
	const required = (
		capabilities ? extractAllVariables(capabilities) : []
	).filter((name) => !INTERNAL_OAUTH_VAR.test(name));
	const catalog = Object.keys(values)
		.filter((name) => !INTERNAL_OAUTH_VAR.test(name))
		.sort();
	const names = new Set([...required, ...catalog]);
	const secrets = [...names].sort().map((name) => {
		const value = values[name];
		const isSet = typeof value === "string" && value.length > 0;
		const hint = isSet ? secretHint(value) : "";
		return { name, isSet, hint };
	});
	return { required, catalog, secrets };
}
