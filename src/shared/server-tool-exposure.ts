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

/**
 * A server with no `expose` written down exposes everything: declaring a
 * server you then cannot call is never what someone meant. `none` is the
 * opt-out for the explicit-`tools:`-only behavior.
 */
export function effectiveExpose(server: MCPServer): ServerToolExposure {
	return server.expose ?? "all";
}

/** Servers whose remote tools become capa tools (everything but `none`). */
export function serversWithExposePolicy(
	capabilities: Capabilities,
): MCPServer[] {
	return (capabilities.servers ?? []).filter(
		(s) => effectiveExpose(s) !== "none",
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

	// The explicit entry covering each remote tool, per server — it wins over a
	// synthesized one, and the policy still has to expose it.
	const overlaid = new Map<string, Map<string, Tool>>();
	const takenQualifiedNames = new Set<string>();
	for (const tool of capabilities.tools ?? []) {
		takenQualifiedNames.add(normalizeToolName(getQualifiedToolName(tool)));
		if (tool.type !== "mcp") continue;
		const serverId = tool.def.server.replace(/^@/, "");
		const bucket = overlaid.get(serverId) ?? new Map<string, Tool>();
		if (!bucket.has(tool.def.tool)) bucket.set(tool.def.tool, tool);
		overlaid.set(serverId, bucket);
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
		const alreadyExplicit = overlaid.get(server.id);

		// An explicit `tools:` entry is the author's last word: it wins over the
		// policy even where `except`/`exactly` left that remote tool out. Say so —
		// a denylisted tool that stays callable because something declared it is
		// exactly the kind of thing to notice at install time.
		const selected = new Set(exposed);
		const overriding: string[] = [];
		for (const [remoteName, tool] of alreadyExplicit ?? []) {
			if (selected.has(remoteName) || !byName.has(remoteName)) continue;
			selected.add(remoteName);
			exposed.push(remoteName);
			overriding.push(`${remoteName} (as "${tool.id}")`);
		}
		if (overriding.length > 0) {
			warnings.push(
				`Server "${server.id}" (expose: ${effectiveExpose(server)}) leaves out tool(s) that the \`tools:\` section declares, so they stay exposed: ${overriding.join(", ")}. Remove the \`tools:\` entry to keep them hidden.`,
			);
		}

		for (const name of exposed) {
			const overlay = alreadyExplicit?.get(name);
			if (overlay) {
				// Keep the authored entry exactly as written — alias, defaults,
				// formatter — but let the policy expose it, or it would still need
				// a skill `requires:` while its siblings do not.
				synthesized.push({ ...overlay, fromServerExpose: true });
				continue;
			}
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
			tools: mergeExposedTools(capabilities.tools ?? [], synthesized),
		},
		added: synthesized,
		warnings,
	};
}

/**
 * Authored tools plus the ones a server policy exposes. An exposed entry
 * replaces the authored tool it was built from (an overlay is the authored
 * entry plus the policy marker), so neither list is duplicated.
 */
export function mergeExposedTools(authored: Tool[], exposed: Tool[]): Tool[] {
	if (exposed.length === 0) return authored;
	const exposedNames = new Set(exposed.map((t) => getQualifiedToolName(t)));
	return [
		...authored.filter((t) => !exposedNames.has(getQualifiedToolName(t))),
		...exposed,
	];
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
