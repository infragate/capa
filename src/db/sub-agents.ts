import type { Database } from "bun:sqlite";
import { canonicalizePath } from "../shared/paths";

export interface InstalledSubAgent {
	agent_id: string;
	legacy_unscoped: boolean;
	installations: SubAgentInstallation[];
}

export interface SubAgentInstallation {
	install_path: string;
	provider_ids: string[];
}

export interface SubAgentInstallationInput {
	installPath: string;
	providerIds: string[];
	/** Real-checkout installs retire pre-migration unscoped ownership; shadows do not. */
	migrateLegacy: boolean;
}

export interface SubAgentInstallationRemoval {
	installPath: string;
	/** Remove a pre-migration unscoped row when no scoped installations remain. */
	removeLegacy: boolean;
}

export class SubAgentsRepo {
	constructor(private db: Database) {}

	upsert(
		projectId: string,
		agentId: string,
		installation?: SubAgentInstallationInput,
	): void {
		const now = Date.now();
		const tx = this.db.transaction(() => {
			this.db.run(
				`INSERT INTO sub_agents
			   (project_id, agent_id, ownership_scoped, created_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(project_id, agent_id) DO UPDATE SET
			   ownership_scoped = CASE
			     WHEN ? THEN 1
			     ELSE sub_agents.ownership_scoped
			   END`,
				[
					projectId,
					agentId,
					installation ? 1 : 0,
					now,
					installation?.migrateLegacy ? 1 : 0,
				],
			);
			if (!installation) return;

			this.db.run(
				`INSERT INTO sub_agent_installations
			   (project_id, agent_id, install_path, provider_ids, created_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(project_id, agent_id, install_path) DO UPDATE SET
			   provider_ids = excluded.provider_ids`,
				[
					projectId,
					agentId,
					canonicalizePath(installation.installPath),
					JSON.stringify([...new Set(installation.providerIds)]),
					now,
				],
			);
		});
		tx();
	}

	getAll(projectId: string): InstalledSubAgent[] {
		const agents = this.db
			.query(
				"SELECT agent_id, ownership_scoped FROM sub_agents WHERE project_id = ?",
			)
			.all(projectId) as Array<{
			agent_id: string;
			ownership_scoped: number;
		}>;
		const installations = this.db
			.query(
				`SELECT agent_id, install_path, provider_ids
			 FROM sub_agent_installations
			 WHERE project_id = ?
			 ORDER BY agent_id, install_path`,
			)
			.all(projectId) as Array<{
			agent_id: string;
			install_path: string;
			provider_ids: string;
		}>;

		return agents.map((agent) => ({
			agent_id: agent.agent_id,
			legacy_unscoped: agent.ownership_scoped === 0,
			installations: installations
				.filter((installation) => installation.agent_id === agent.agent_id)
				.map((installation) => ({
					install_path: installation.install_path,
					provider_ids: JSON.parse(installation.provider_ids) as string[],
				})),
		}));
	}

	removeInstallation(
		projectId: string,
		agentId: string,
		removal: SubAgentInstallationRemoval,
	): void {
		const tx = this.db.transaction(() => {
			this.db.run(
				`DELETE FROM sub_agent_installations
			   WHERE project_id = ? AND agent_id = ? AND install_path = ?`,
				[projectId, agentId, canonicalizePath(removal.installPath)],
			);
			const row = this.db
				.query(
					`SELECT ownership_scoped,
					        (SELECT COUNT(*) FROM sub_agent_installations
					         WHERE project_id = ? AND agent_id = ?) AS target_count
					 FROM sub_agents
					 WHERE project_id = ? AND agent_id = ?`,
				)
				.get(projectId, agentId, projectId, agentId) as {
				ownership_scoped: number;
				target_count: number;
			} | null;
			if (
				row?.target_count === 0 &&
				(row.ownership_scoped === 1 || removal.removeLegacy)
			) {
				this.db.run(
					"DELETE FROM sub_agents WHERE project_id = ? AND agent_id = ?",
					[projectId, agentId],
				);
			}
		});
		tx();
	}

	remove(projectId: string, agentId: string): void {
		const tx = this.db.transaction(() => {
			this.db.run(
				"DELETE FROM sub_agent_installations WHERE project_id = ? AND agent_id = ?",
				[projectId, agentId],
			);
			this.db.run(
				"DELETE FROM sub_agents WHERE project_id = ? AND agent_id = ?",
				[projectId, agentId],
			);
		});
		tx();
	}
}
