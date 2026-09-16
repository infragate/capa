import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "fs";

export interface FileLockOptions {
	/** Give up waiting after this long. */
	timeoutMs?: number;
	/** A lock older than this is treated as abandoned. */
	staleMs?: number;
	pollMs?: number;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM: the process exists but belongs to someone else.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isStale(lockPath: string, staleMs: number): boolean {
	try {
		if (Date.now() - statSync(lockPath).mtimeMs > staleMs) return true;
		const pid = Number.parseInt(readFileSync(lockPath, "utf-8"), 10);
		return Number.isFinite(pid) && pid > 0 && !isProcessAlive(pid);
	} catch {
		// Vanished between checks — just retry.
		return false;
	}
}

/**
 * Cross-process mutex backed by an exclusively-created lock file. Resolves to
 * a release function. Locks left by crashed processes (dead pid or older than
 * `staleMs`) are taken over.
 */
export async function acquireFileLock(
	lockPath: string,
	options: FileLockOptions = {},
): Promise<() => void> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	const staleMs = options.staleMs ?? 120_000;
	const pollMs = options.pollMs ?? 50;
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeSync(fd, String(process.pid));
			} finally {
				closeSync(fd);
			}
			return () => {
				try {
					if (readFileSync(lockPath, "utf-8") === String(process.pid)) {
						unlinkSync(lockPath);
					}
				} catch {
					// already released or taken over
				}
			};
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}

		if (isStale(lockPath, staleMs)) {
			try {
				unlinkSync(lockPath);
			} catch {
				// another waiter removed it first
			}
			continue;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for lock ${lockPath}`);
		}
		await Bun.sleep(pollMs);
	}
}
