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
