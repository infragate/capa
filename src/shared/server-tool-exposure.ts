import type {
	Capabilities,
	MCPServer,
	Tool,
} from "../types/capabilities";
import { getQualifiedToolName } from "../types/capabilities";

/** One entry of a server's live `tools/list`. */
export interface RemoteToolInfo {
	name: string;
	description?: string;
}

/** Servers that opted into exposing remote tools without per-tool YAML. */
export function serversWithExposePolicy(
	capabilities: Capabilities,
): MCPServer[] {
	return (capabilities.servers ?? []).filter((s) => s.expose);
}

/**
 * Remote tool names a server exposes, given its policy and what the server
 * actually advertises. Names in `except`/`exactly` that the server does not
 * advertise are returned separately so install can warn about the typo.
 */
export function selectExposedToolNames(
	server: MCPServer,
	remoteNames: string[],
): { exposed: string[]; unknown: string[] } {
	const named = new Set(server.tools ?? []);
	const advertised = new Set(remoteNames);
	const unknown = [...named].filter((n) => !advertised.has(n));

	switch (server.expose) {
		case "all":
			return { exposed: remoteNames, unknown: [] };
		case "except":
			return { exposed: remoteNames.filter((n) => !named.has(n)), unknown };
		case "exactly":
			return { exposed: remoteNames.filter((n) => named.has(n)), unknown };
		default:
			return { exposed: [], unknown: [] };
	}
}

/**
 * Local id for a synthesized tool. The remote name is kept as-is wherever it
 * can be one — an invented alias would not match the `except`/`exactly` lists
 * the user wrote, and is the id they see in `capa sh`.
 */
export function synthesizedToolId(remoteName: string): string {
	return remoteName.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Add a tool entry for every remote tool a server exposes. An explicit
 * `tools:` entry pointing at the same remote tool wins — that is how a Brave
 * `count: 5` default survives `expose: all` without listing every other tool.
 *
 * Returns a new Capabilities; the input is not modified, and the synthesized
 * entries are never written back to the capabilities file.
 */
export async function expandServerExposedTools(
	capabilities: Capabilities,
	listRemoteTools: (serverId: string) => Promise<RemoteToolInfo[]>,
): Promise<{ capabilities: Capabilities; added: Tool[]; warnings: string[] }> {
	const servers = serversWithExposePolicy(capabilities);
	if (servers.length === 0) return { capabilities, added: [], warnings: [] };

	const warnings: string[] = [];
	const synthesized: Tool[] = [];

	// Remote tools already covered by an explicit entry, per server.
	const overlaid = new Map<string, Set<string>>();
	const takenQualifiedNames = new Set<string>();
	for (const tool of capabilities.tools ?? []) {
		takenQualifiedNames.add(getQualifiedToolName(tool));
		if (tool.type !== "mcp") continue;
		const serverId = tool.def.server.replace(/^@/, "");
		const bucket = overlaid.get(serverId) ?? new Set<string>();
		bucket.add(tool.def.tool);
		overlaid.set(serverId, bucket);
	}

	for (const server of servers) {
		let remote: RemoteToolInfo[];
		try {
			remote = await listRemoteTools(server.id);
		} catch (error) {
			warnings.push(
				`Server "${server.id}" (expose: ${server.expose}) could not be listed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			continue;
		}

		const { exposed, unknown } = selectExposedToolNames(
			server,
			remote.map((t) => t.name),
		);
		if (unknown.length > 0) {
			warnings.push(
				`Server "${server.id}" (expose: ${server.expose}) names tool(s) it does not advertise: ${unknown.join(", ")}`,
			);
		}
		if (remote.length === 0) {
			warnings.push(
				`Server "${server.id}" (expose: ${server.expose}) advertised no tools — check its credentials or connection.`,
			);
			continue;
		}

		const byName = new Map(remote.map((t) => [t.name, t]));
		const alreadyExplicit = overlaid.get(server.id);
		for (const name of exposed) {
			if (alreadyExplicit?.has(name)) continue;
			const tool: Tool = {
				id: synthesizedToolId(name),
				type: "mcp",
				description: byName.get(name)?.description,
				fromServerExpose: true,
				def: { server: `@${server.id}`, tool: name },
			};
			const qualified = getQualifiedToolName(tool);
			if (takenQualifiedNames.has(qualified)) continue;
			takenQualifiedNames.add(qualified);
			synthesized.push(tool);
		}
	}

	if (synthesized.length === 0) return { capabilities, added: [], warnings };
	return {
		capabilities: {
			...capabilities,
			tools: [...(capabilities.tools ?? []), ...synthesized],
		},
		added: synthesized,
		warnings,
	};
}

/**
 * Qualified names of every tool a server exposes through its policy. Used to
 * activate a whole server (`setup_tools(['@github'])`) and to keep policy
 * tools out of the "not required by any skill" warning.
 */
export function exposedToolNamesForServer(
	capabilities: Capabilities,
	serverId: string,
): string[] {
	return (capabilities.tools ?? [])
		.filter(
			(t) =>
				t.fromServerExpose &&
				t.type === "mcp" &&
				t.def.server.replace(/^@/, "") === serverId,
		)
		.map((t) => getQualifiedToolName(t));
}
