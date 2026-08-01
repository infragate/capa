import type { CapaDatabase } from "../db/database";
import type { Capabilities } from "../types/capabilities";
import { buildVariablesResponse } from "./capabilities-routes";
import type { SessionManager } from "./session-manager";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface VariablesRouteDeps {
	db: CapaDatabase;
	sessionManager: SessionManager;
}

export async function handleGetVariables(
	deps: VariablesRouteDeps,
	projectId: string,
): Promise<Response> {
	const capabilities = deps.sessionManager.getProjectCapabilities(projectId);
	const values = deps.db.getAllVariables(projectId);
	const body = buildVariablesResponse(capabilities, values);
	return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}

export async function handleSetVariables(
	deps: VariablesRouteDeps,
	projectId: string,
	request: Request,
): Promise<Response> {
	try {
		const variables: Record<string, string> = await request.json();
		for (const [key, value] of Object.entries(variables)) {
			deps.db.setVariable(projectId, key, value);
		}
		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
}

export async function handlePutVariable(
	deps: VariablesRouteDeps,
	projectId: string,
	name: string,
	request: Request,
): Promise<Response> {
	try {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			return new Response(JSON.stringify({ error: "Invalid variable name" }), {
				status: 400,
				headers: JSON_HEADERS,
			});
		}
		let value = "";
		try {
			const body = (await request.json()) as { value?: string };
			if (typeof body?.value === "string") value = body.value;
		} catch {
			// empty body → create with empty value
		}
		deps.db.setVariable(projectId, name, value);
		return new Response(JSON.stringify({ success: true }), {
			headers: JSON_HEADERS,
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleDeleteVariable(
	deps: VariablesRouteDeps,
	projectId: string,
	name: string,
): Promise<Response> {
	deps.db.deleteVariable(projectId, name);
	return new Response(JSON.stringify({ success: true }), {
		headers: JSON_HEADERS,
	});
}
