import type { Database } from "bun:sqlite";
import type { Project, ProjectInstallState } from "../types/database";

export class ProjectsRepo {
	constructor(private db: Database) {}

	upsert(project: Omit<Project, "created_at" | "updated_at">): void {
		const now = Date.now();
		const existing = this.db
			.query("SELECT id FROM projects WHERE id = ?")
			.get(project.id);

		if (existing) {
			this.db.run("UPDATE projects SET path = ?, updated_at = ? WHERE id = ?", [
				project.path,
				now,
				project.id,
			]);
		} else {
			this.db.run(
				"INSERT INTO projects (id, path, created_at, updated_at) VALUES (?, ?, ?, ?)",
				[project.id, project.path, now, now],
			);
		}
	}

	get(id: string): Project | null {
		return this.db
			.query("SELECT * FROM projects WHERE id = ?")
			.get(id) as Project | null;
	}

	getByPath(path: string): Project | null {
		return this.db
			.query("SELECT * FROM projects WHERE path = ?")
			.get(path) as Project | null;
	}

	getAll(): Project[] {
		return this.db
			.query("SELECT * FROM projects ORDER BY updated_at DESC")
			.all() as Project[];
	}

	delete(projectId: string): void {
		const tx = this.db.transaction((id: string) => {
			this.db.run("DELETE FROM variables WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM managed_files WHERE project_id = ?", [id]);
			this.db.run(
				"DELETE FROM managed_instruction_targets WHERE project_id = ?",
				[id],
			);
			this.db.run("DELETE FROM tool_init_state WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM sessions WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM oauth_tokens WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM oauth_flow_state WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM project_capabilities WHERE project_id = ?", [
				id,
			]);
			this.db.run("DELETE FROM sub_agent_installations WHERE project_id = ?", [
				id,
			]);
			this.db.run("DELETE FROM sub_agents WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM project_providers WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM project_install_state WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM tool_calls WHERE project_id = ?", [id]);
			this.db.run("DELETE FROM projects WHERE id = ?", [id]);
		});
		tx(projectId);
	}

	setProviders(projectId: string, providers: string[]): void {
		const now = Date.now();
		this.db.run("DELETE FROM project_providers WHERE project_id = ?", [
			projectId,
		]);
		const seen = new Set<string>();
		for (const pid of providers) {
			if (seen.has(pid)) continue;
			seen.add(pid);
			this.db.run(
				"INSERT INTO project_providers (project_id, provider_id, created_at) VALUES (?, ?, ?)",
				[projectId, pid, now],
			);
		}
	}

	/** Record the outcome of a `capa install` (read back by `capa status`). */
	setInstallState(projectId: string, state: ProjectInstallState): void {
		this.db.run(
			`INSERT INTO project_install_state
         (project_id, fingerprint, capa_version, installed_at, completed, failed, errors_json, counts_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         capa_version = excluded.capa_version,
         installed_at = excluded.installed_at,
         completed = excluded.completed,
         failed = excluded.failed,
         errors_json = excluded.errors_json,
         counts_json = excluded.counts_json`,
			[
				projectId,
				state.fingerprint,
				state.capaVersion,
				state.installedAt,
				state.completed ? 1 : 0,
				state.failed,
				JSON.stringify(state.errors),
				JSON.stringify(state.counts),
			],
		);
	}

	getInstallState(projectId: string): ProjectInstallState | null {
		return readInstallState(this.db, projectId);
	}

	getProviders(projectId: string): string[] {
		const rows = this.db
			.query(
				"SELECT provider_id FROM project_providers WHERE project_id = ? ORDER BY rowid",
			)
			.all(projectId) as Array<{ provider_id: string }>;
		return rows.map((r) => r.provider_id);
	}

	setCapabilities(projectId: string, capabilitiesJson: string): void {
		const now = Date.now();
		this.db.run(
			`INSERT INTO project_capabilities (project_id, capabilities_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET capabilities_json = ?, updated_at = ?`,
			[projectId, capabilitiesJson, now, capabilitiesJson, now],
		);
	}

	getCapabilities(projectId: string): string | null {
		const row = this.db
			.query(
				"SELECT capabilities_json FROM project_capabilities WHERE project_id = ?",
			)
			.get(projectId) as { capabilities_json: string } | null;
		return row?.capabilities_json ?? null;
	}
}

type InstallStateRow = {
	fingerprint: string;
	capa_version: string;
	installed_at: number;
	completed: number;
	failed: number;
	errors_json: string;
	counts_json?: string;
};

/**
 * Read a project's install record. Shared with `capa status`, which opens the
 * database read-only instead of through CapaDatabase (no schema setup or
 * secret migration just to look). Null when the table predates #332.
 */
export function readInstallState(db: Database, projectId: string): ProjectInstallState | null {
	let row: InstallStateRow | null;
	try {
		row = db
			.query("SELECT * FROM project_install_state WHERE project_id = ?")
			.get(projectId) as InstallStateRow | null;
	} catch {
		return null;
	}
	if (!row) return null;
	const parse = <T>(json: string | undefined, ok: (v: unknown) => v is T, fallback: T): T => {
		try {
			const v = JSON.parse(json ?? "");
			return ok(v) ? v : fallback;
		} catch {
			return fallback;
		}
	};
	const isStrings = (v: unknown): v is string[] =>
		Array.isArray(v) && v.every((e) => typeof e === "string");
	const isCounts = (v: unknown): v is ProjectInstallState["counts"] =>
		!!v &&
		typeof v === "object" &&
		["skills", "plugins", "servers", "hooks"].every(
			(k) => typeof (v as Record<string, unknown>)[k] === "number",
		);
	return {
		fingerprint: row.fingerprint,
		capaVersion: row.capa_version,
		installedAt: row.installed_at,
		completed: row.completed === 1,
		failed: row.failed,
		errors: parse(row.errors_json, isStrings, []),
		counts: parse(row.counts_json, isCounts, { skills: 0, plugins: 0, servers: 0, hooks: 0 }),
	};
}
