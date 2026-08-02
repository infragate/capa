import { existsSync, type FSWatcher, statSync, watch } from "fs";
import { basename, dirname } from "path";
import { detectCapabilitiesFile } from "../shared/paths";

const DEBOUNCE_MS = 400;
/** Ignore watcher events shortly after a capa-owned write to the same file. */
const SELF_WRITE_GRACE_MS = 1200;
/** Backup poll — fs.watch can drop events on Windows. */
const POLL_MS = 1500;

export type CapabilitiesChangeHandler = (
	projectId: string,
) => void | Promise<void>;

/**
 * Watches each project's capabilities.yaml/json so the running server (and UI)
 * stay in sync with on-disk edits — including those made outside capa.
 */
export class CapabilitiesFileWatcher {
	private watchers = new Map<string, FSWatcher>();
	private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private mtimes = new Map<string, number>();
	private selfWriteUntil = new Map<string, number>();
	private projectPaths = new Map<string, string>();
	private filePaths = new Map<string, string>();
	private running = new Set<string>();

	constructor(
		private readonly onChange: CapabilitiesChangeHandler,
		private readonly log: {
			info: (m: string) => void;
			warn: (m: string) => void;
			debug: (m: string) => void;
		},
	) {}

	/** Call immediately before/after capa writes the capabilities file. */
	markSelfWrite(projectId: string): void {
		this.selfWriteUntil.set(projectId, Date.now() + SELF_WRITE_GRACE_MS);
	}

	async watchProject(projectId: string, projectPath: string): Promise<void> {
		// Already watching the same project path — leave the handles alone.
		if (
			this.projectPaths.get(projectId) === projectPath &&
			this.watchers.has(projectId)
		) {
			return;
		}
		this.unwatchProject(projectId);
		this.projectPaths.set(projectId, projectPath);

		let file: { path: string; format: "json" | "yaml" } | null = null;
		try {
			file = await detectCapabilitiesFile(projectPath);
		} catch (err: any) {
			this.log.warn(
				`Capabilities watch skipped for ${projectId}: ${err?.message ?? err}`,
			);
			return;
		}
		if (!file) {
			this.log.debug(`No capabilities file to watch for ${projectId}`);
			return;
		}

		this.filePaths.set(projectId, file.path);
		this.mtimes.set(projectId, safeMtime(file.path));

		const capsDir = dirname(file.path);
		const capsName = basename(file.path);

		try {
			const w = watch(capsDir, { persistent: true }, (_event, filename) => {
				if (
					filename &&
					filename !== capsName &&
					basename(String(filename)) !== capsName
				) {
					return;
				}
				this.schedule(projectId);
			});
			w.on("error", (err) => {
				this.log.warn(
					`Capabilities watch error for ${projectId}: ${err.message}`,
				);
			});
			this.watchers.set(projectId, w);
		} catch (err: any) {
			this.log.warn(`fs.watch failed for ${projectId}: ${err?.message ?? err}`);
		}

		const poll = setInterval(() => this.checkMtime(projectId), POLL_MS);
		// Keep referenced so the timer is not GC'd in long-running server.
		this.pollTimers.set(projectId, poll);
		this.log.debug(`Watching capabilities for ${projectId}: ${file.path}`);
	}

	unwatchProject(projectId: string): void {
		const w = this.watchers.get(projectId);
		if (w) {
			try {
				w.close();
			} catch {
				// ignore
			}
			this.watchers.delete(projectId);
		}
		const poll = this.pollTimers.get(projectId);
		if (poll) {
			clearInterval(poll);
			this.pollTimers.delete(projectId);
		}
		const debounce = this.debounceTimers.get(projectId);
		if (debounce) {
			clearTimeout(debounce);
			this.debounceTimers.delete(projectId);
		}
		this.mtimes.delete(projectId);
		this.selfWriteUntil.delete(projectId);
		this.projectPaths.delete(projectId);
		this.filePaths.delete(projectId);
		this.running.delete(projectId);
	}

	stop(): void {
		for (const id of [...this.watchers.keys()]) {
			this.unwatchProject(id);
		}
	}

	/** Re-resolve the file path (e.g. after yaml↔json switch) and restart watch. */
	async refreshProject(projectId: string): Promise<void> {
		const projectPath = this.projectPaths.get(projectId);
		if (!projectPath) return;
		await this.watchProject(projectId, projectPath);
	}

	private checkMtime(projectId: string): void {
		const filePath = this.filePaths.get(projectId);
		if (!filePath || !existsSync(filePath)) {
			// File may have been renamed/removed — try re-detect.
			const projectPath = this.projectPaths.get(projectId);
			if (projectPath) void this.watchProject(projectId, projectPath);
			return;
		}
		const mtime = safeMtime(filePath);
		const prev = this.mtimes.get(projectId);
		if (prev != null && mtime !== prev) {
			this.schedule(projectId);
		}
	}

	private schedule(projectId: string): void {
		const existing = this.debounceTimers.get(projectId);
		if (existing) clearTimeout(existing);
		this.debounceTimers.set(
			projectId,
			setTimeout(() => {
				this.debounceTimers.delete(projectId);
				void this.fire(projectId);
			}, DEBOUNCE_MS),
		);
	}

	private async fire(projectId: string): Promise<void> {
		if (this.running.has(projectId)) {
			this.schedule(projectId);
			return;
		}

		const filePath = this.filePaths.get(projectId);
		const until = this.selfWriteUntil.get(projectId) ?? 0;
		if (Date.now() < until) {
			// Swallow our own write; adopt the new mtime so we don't re-fire later.
			if (filePath && existsSync(filePath)) {
				this.mtimes.set(projectId, safeMtime(filePath));
			}
			return;
		}

		if (!filePath || !existsSync(filePath)) return;

		const mtime = safeMtime(filePath);
		if (mtime === this.mtimes.get(projectId)) {
			return;
		}
		this.mtimes.set(projectId, mtime);

		this.running.add(projectId);
		try {
			this.log.info(`Capabilities file changed for ${projectId}, reloading`);
			await this.onChange(projectId);
		} catch (err: any) {
			this.log.warn(
				`Failed to reload capabilities for ${projectId}: ${err?.message ?? err}`,
			);
		} finally {
			this.running.delete(projectId);
			// Capture mtime after reload (configure may not touch the file).
			if (filePath && existsSync(filePath)) {
				this.mtimes.set(projectId, safeMtime(filePath));
			}
		}
	}
}

function safeMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}
