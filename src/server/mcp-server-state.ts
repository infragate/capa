import type { MCPServer } from "../types/capabilities";

/**
 * In-memory per-project MCP server on/off state.
 * Resets when the capa HTTP server restarts (not persisted).
 */
export class McpServerStateManager {
	private enabledByProject = new Map<string, Set<string>>();

	isEnabled(projectId: string, serverId: string): boolean {
		const clean = serverId.replace(/^@/, "");
		return this.enabledByProject.get(projectId)?.has(clean) ?? false;
	}

	setEnabled(projectId: string, serverId: string, enabled: boolean): void {
		const clean = serverId.replace(/^@/, "");
		let set = this.enabledByProject.get(projectId);
		if (!set) {
			set = new Set();
			this.enabledByProject.set(projectId, set);
		}
		if (enabled) {
			set.add(clean);
		} else {
			set.delete(clean);
		}
		if (set.size === 0) {
			this.enabledByProject.delete(projectId);
		}
	}

	getEnabledServers(projectId: string): ReadonlySet<string> {
		return this.enabledByProject.get(projectId) ?? new Set();
	}
}

/** Turn on every server in capabilities; turn off servers removed since last configure. */
export function syncProjectServerEnablement(
	mcpServerState: McpServerStateManager,
	projectId: string,
	servers: MCPServer[] | undefined,
	previousServers?: MCPServer[],
): void {
	const current = servers ?? [];
	const currentIds = new Set(current.map((s) => s.id.replace(/^@/, "")));
	for (const server of current) {
		mcpServerState.setEnabled(projectId, server.id, true);
	}
	for (const prev of previousServers ?? []) {
		const id = prev.id.replace(/^@/, "");
		if (!currentIds.has(id)) {
			mcpServerState.setEnabled(projectId, prev.id, false);
		}
	}
}
