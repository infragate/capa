import type {
	Capabilities,
	MCPServer,
	ServerToolExposure,
	Tool,
} from "../types/capabilities";
import { getQualifiedToolName, normalizeToolName } from "../types/capabilities";

/** One entry of a server's live `tools/list`. */
export interface RemoteToolInfo {
	name: string;
	description?: string;
}

/** Server ids that at least one `tools:` entry points at. */
export function serverIdsWithDeclaredTools(
	capabilities: Capabilities,
): Set<string> {
	const ids = new Set<string>();
	for (const tool of capabilities.tools ?? []) {
		if (tool.type !== "mcp") continue;
		ids.add(tool.def.server.replace(/^@/, ""));
	}
	return ids;
}

/**
 * A server with no `expose` written down exposes everything: declaring a
 * server you then cannot call is never what someone meant. `none` is the
 * explicit opt-out.
 */
export function effectiveExpose(server: MCPServer): ServerToolExposure {
	return server.expose ?? "all";
}

/**
 * Servers whose live tools become capa tools.
 *
 * **Declaring tools yourself turns the policy off.** Once any `tools:` entry
 * points at a server, that list is the whole set for it — exactly how capa
 * behaved before `expose` existed, so no existing file changes meaning. The
 * policy is for servers you have not curated by hand.
 */
export function serversWithExposePolicy(
	capabilities: Capabilities,
): MCPServer[] {
	const declared = serverIdsWithDeclaredTools(capabilities);
	return (capabilities.servers ?? []).filter(
		(s) => !declared.has(s.id) && effectiveExpose(s) !== "none",
	);
}

/**
 * Servers whose `expose` is written down but ignored because the `tools:`
 * section already declares entries for them. Surfaced at install: a policy
 * that silently does nothing is worth one line of output.
 */
export function serversWithIgnoredExpose(
	capabilities: Capabilities,
): MCPServer[] {
	const declared = serverIdsWithDeclaredTools(capabilities);
	return (capabilities.servers ?? []).filter(
		(s) => declared.has(s.id) && s.expose !== undefined && s.expose !== "none",
	);
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

	switch (effectiveExpose(server)) {
		case "except":
			return { exposed: remoteNames.filter((n) => !named.has(n)), unknown };
		case "exactly":
			return { exposed: remoteNames.filter((n) => named.has(n)), unknown };
		case "none":
			return { exposed: [], unknown: [] };
		default:
			return { exposed: remoteNames, unknown: [] };
	}
}

/**
 * Local id for a synthesized tool. The remote name is kept as-is wherever it
 * can be one — an invented alias would not match the `except`/`exactly` lists
 * the user wrote, and is the id they see in `capa sh`. Dots become underscores
 * because tool lookup collapses them, so `a.b` and `a_b` would otherwise
 * resolve to each other.
 */
export function synthesizedToolId(remoteName: string): string {
	return remoteName.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * A qualified name for this remote tool that no other tool answers to, since
 * sanitizing is many-to-one (`foo/bar` and `foo?bar` both become `foo_bar`)
 * and lookup compares names with dots collapsed. Suffixes on collision rather
 * than dropping the tool — a silently missing tool is worse than an odd id.
 */
function uniqueToolId(
	remoteName: string,
	serverId: string,
	takenQualified: Set<string>,
): string {
	const base = synthesizedToolId(remoteName);
	let id = base;
	for (
		let n = 2;
		takenQualified.has(normalizeToolName(`${serverId}.${id}`));
		n++
	) {
		id = `${base}_${n}`;
	}
	return id;
}

/**
 * Add a tool entry for every remote tool a server exposes. Servers the
 * `tools:` section already declares entries for are left alone — those entries
 * are the whole set for that server.
 *
 * Returns a new Capabilities; the input is not modified, and the synthesized
 * entries are never written back to the capabilities file.
 */
export async function expandServerExposedTools(
	capabilities: Capabilities,
	listRemoteTools: (serverId: string) => Promise<RemoteToolInfo[]>,
): Promise<{ capabilities: Capabilities; added: Tool[]; warnings: string[] }> {
	const warnings: string[] = [];
	for (const server of serversWithIgnoredExpose(capabilities)) {
		warnings.push(
			`Server "${server.id}": expose: ${server.expose} is ignored because the \`tools:\` section declares entries for it — those entries are the tools for this server. Remove them to let the policy choose.`,
		);
	}

	const servers = serversWithExposePolicy(capabilities);
	if (servers.length === 0) return { capabilities, added: [], warnings };

	const synthesized: Tool[] = [];

	// Ids must not collide with an existing tool, including a command tool
	// grouped under this server's name.
	const takenQualifiedNames = new Set<string>();
	for (const tool of capabilities.tools ?? []) {
		takenQualifiedNames.add(normalizeToolName(getQualifiedToolName(tool)));
	}

	// One round-trip per server, all at once: a server that is down burns the
	// whole timeout, and doing that serially adds it up across servers.
	const listings = await Promise.all(
		servers.map((server) =>
			// `Promise.resolve().then` so a lister that throws synchronously lands
			// in the same warning path as one that rejects — discovery is
			// best-effort and must never fail the configure around it.
			Promise.resolve()
				.then(() => listRemoteTools(server.id))
				.then(
					(remote) => ({ remote, error: null as unknown }),
					(error) => ({ remote: null, error }),
				),
		),
	);

	for (const [index, server] of servers.entries()) {
		const listing = listings[index];
		if (!listing.remote) {
			warnings.push(
				`Server "${server.id}" (expose: ${effectiveExpose(server)}) could not be listed: ${
					listing.error instanceof Error
						? listing.error.message
						: String(listing.error)
				}`,
			);
			continue;
		}
		const remote = listing.remote;

		const { exposed, unknown } = selectExposedToolNames(
			server,
			remote.map((t) => t.name),
		);
		if (unknown.length > 0) {
			warnings.push(
				`Server "${server.id}" (expose: ${effectiveExpose(server)}) names tool(s) it does not advertise: ${unknown.join(", ")}`,
			);
		}
		if (remote.length === 0) {
			warnings.push(
				`Server "${server.id}" (expose: ${effectiveExpose(server)}) advertised no tools — check its credentials or connection.`,
			);
			continue;
		}

		const byName = new Map(remote.map((t) => [t.name, t]));

		for (const name of exposed) {
			// Ids are scoped per server, so only this server's names can clash.
			const id = uniqueToolId(name, server.id, takenQualifiedNames);
			const tool: Tool = {
				id,
				type: "mcp",
				description: byName.get(name)?.description,
				fromServerExpose: true,
				def: { server: `@${server.id}`, tool: name },
			};
			takenQualifiedNames.add(normalizeToolName(getQualifiedToolName(tool)));
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
