import { existsSync, type FSWatcher, statSync, watch } from "fs";
import { basename, dirname, join, resolve } from "path";
import {
	detectCapabilitiesFile,
	listCapabilitiesCandidates,
} from "../shared/paths";

const DEBOUNCE_MS = 400;
/** Ignore watcher events shortly after a capa-owned write to the same file. */
const SELF_WRITE_GRACE_MS = 1200;
/** Backup poll — fs.watch can drop events on Windows. */
const POLL_MS = 1500;

export type CapabilitiesChangeHandler = (
	projectId: string,
) => void | Promise<void>;

/**
 * Watches each project's capabilities file so the running server (and UI)
 * stay in sync with on-disk edits — including those made outside capa.
 *
 * Re-runs discovery when the winning file changes (format or location).
 */
export class CapabilitiesFileWatcher {
	private watchers = new Map<string, FSWatcher[]>();
	private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private mtimes = new Map<string, number>();
	private selfWriteUntil = new Map<string, number>();
	private projectPaths = new Map<string, string>();
	private filePaths = new Map<string, string>();
	private running = new Set<string>();
	private rebinding = new Set<string>();

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
		const absProject = resolve(projectPath);
		const file = await detectCapabilitiesFile(absProject);
		const previous = this.filePaths.get(projectId);
		const alreadySameProject =
			this.projectPaths.get(projectId) === absProject &&
			(this.watchers.get(projectId)?.length ?? 0) > 0;

		if (alreadySameProject && file?.path === previous) {
			return;
		}

		const selfUntil = this.selfWriteUntil.get(projectId);
		this.clearHandles(projectId);
		if (selfUntil != null) this.selfWriteUntil.set(projectId, selfUntil);

		this.projectPaths.set(projectId, absProject);

		if (file) {
			this.filePaths.set(projectId, file.path);
			// Force a reload when the winner changes (mtime alone may not fire).
			this.mtimes.set(
				projectId,
				previous && previous !== file.path ? 0 : safeMtime(file.path),
			);
		} else {
			this.filePaths.delete(projectId);
			this.mtimes.delete(projectId);
		}

		const handles: FSWatcher[] = [];
		for (const dir of watchDirsForProject(absProject)) {
			try {
				if (!existsSync(dir)) continue;
				const w = watch(dir, { persistent: true }, (_event, filename) => {
					if (filename) {
						const name = basename(String(filename));
						// Root watch also notices `.config` appearing so nested dirs can bind later.
						if (
							dir === absProject &&
							(name === ".config" || name.startsWith(".config"))
						) {
							void this.onFsEvent(projectId);
							return;
						}
						if (!isWatchedBasename(name, absProject, dir)) return;
					}
					void this.onFsEvent(projectId);
				});
				w.on("error", (err) => {
					this.log.warn(
						`Capabilities watch error for ${projectId}: ${err.message}`,
					);
				});
				handles.push(w);
			} catch (err: any) {
				this.log.warn(
					`fs.watch failed for ${projectId} (${dir}): ${err?.message ?? err}`,
				);
			}
		}
		this.watchers.set(projectId, handles);

		const poll = setInterval(() => void this.checkMtime(projectId), POLL_MS);
		this.pollTimers.set(projectId, poll);
		this.log.debug(
			file
				? `Watching capabilities for ${projectId}: ${file.path}`
				: `Watching for capabilities creation in ${projectId}`,
		);

		if (previous && file && previous !== file.path) {
			this.schedule(projectId);
		}
	}

	unwatchProject(projectId: string): void {
		this.clearHandles(projectId);
		this.selfWriteUntil.delete(projectId);
		this.projectPaths.delete(projectId);
		this.filePaths.delete(projectId);
		this.running.delete(projectId);
		this.rebinding.delete(projectId);
	}

	stop(): void {
		for (const id of [...this.projectPaths.keys()]) {
			this.unwatchProject(id);
		}
	}

	/** Re-resolve the file path (e.g. after yaml↔toml switch) and restart watch. */
	async refreshProject(projectId: string): Promise<void> {
		const projectPath = this.projectPaths.get(projectId);
		if (!projectPath) return;
		await this.watchProject(projectId, projectPath);
	}

	private clearHandles(projectId: string): void {
		const handles = this.watchers.get(projectId) ?? [];
		for (const w of handles) {
			try {
				w.close();
			} catch {
				// ignore
			}
		}
		this.watchers.delete(projectId);
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
	}

	private async onFsEvent(projectId: string): Promise<void> {
		const projectPath = this.projectPaths.get(projectId);
		if (!projectPath || this.rebinding.has(projectId)) return;
		this.rebinding.add(projectId);
		try {
			await this.watchProject(projectId, projectPath);
		} finally {
			this.rebinding.delete(projectId);
		}
		this.schedule(projectId);
	}

	private async checkMtime(projectId: string): Promise<void> {
		const projectPath = this.projectPaths.get(projectId);
		if (!projectPath) return;

		const file = await detectCapabilitiesFile(projectPath);
		const previous = this.filePaths.get(projectId);
		if (file?.path !== previous) {
			await this.watchProject(projectId, projectPath);
			if (file) this.schedule(projectId);
			return;
		}

		const filePath = this.filePaths.get(projectId);
		if (!filePath || !existsSync(filePath)) return;

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

		const projectPath = this.projectPaths.get(projectId);
		if (projectPath) {
			const file = await detectCapabilitiesFile(projectPath);
			const previous = this.filePaths.get(projectId);
			if (file?.path !== previous) {
				await this.watchProject(projectId, projectPath);
			}
		}

		const filePath = this.filePaths.get(projectId);
		const until = this.selfWriteUntil.get(projectId) ?? 0;
		if (Date.now() < until) {
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
			if (filePath && existsSync(filePath)) {
				this.mtimes.set(projectId, safeMtime(filePath));
			}
		}
	}
}

function watchDirsForProject(projectPath: string): string[] {
	return [
		projectPath,
		join(projectPath, ".config"),
		join(projectPath, ".config", "capa"),
	];
}

function isWatchedBasename(
	filename: string,
	projectPath: string,
	dir: string,
): boolean {
	const name = basename(filename);
	const candidates = listCapabilitiesCandidates(projectPath);
	return candidates.some(
		(c) => dirname(c.path) === resolve(dir) && basename(c.path) === name,
	);
}

function safeMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}
