import { closeSync, fstatSync, openSync, readFileSync, unlinkSync, writeSync } from "fs";

export interface FileLockOptions {
	/** Give up waiting after this long. */
	timeoutMs?: number;
	/**
	 * A lock whose holder is still alive is only treated as abandoned after
	 * this long (guards against pid reuse). Locks of dead processes are taken
	 * over immediately.
	 */
	staleMs?: number;
	pollMs?: number;
}

/** A lock file without a pid (holder crashed before writing it) is abandoned after this. */
const UNWRITTEN_LOCK_STALE_MS = 10_000;
/** A takeover marker is held for milliseconds; older ones belong to a crashed breaker. */
const BREAK_MARKER_STALE_MS = 30_000;

interface LockInfo {
	pid: number;
	mtimeMs: number;
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

/**
 * Read a lock file through one descriptor, so its metadata and contents come
 * from the same file even if the path is replaced concurrently.
 */
function readLockInfo(path: string): LockInfo | null {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return null;
	}
	try {
		const mtimeMs = fstatSync(fd).mtimeMs;
		const pid = Number.parseInt(readFileSync(fd, "utf-8"), 10);
		return { pid, mtimeMs };
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

function isAbandoned(info: LockInfo, staleMs: number): boolean {
	const age = Date.now() - info.mtimeMs;
	if (!Number.isFinite(info.pid) || info.pid <= 0) return age > UNWRITTEN_LOCK_STALE_MS;
	return !isProcessAlive(info.pid) || age > staleMs;
}

/** Exclusively create `path` holding this process's pid. False if it already exists. */
function tryCreate(path: string): boolean {
	let fd: number;
	try {
		fd = openSync(path, "wx");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EEXIST") return false;
		// Windows reports a file that is being deleted while another process
		// still has it open as EPERM/EACCES/EBUSY: treat it as still held.
		if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
			return false;
		}
		throw err;
	}
	try {
		writeSync(fd, String(process.pid));
	} finally {
		closeSync(fd);
	}
	return true;
}

function removeQuietly(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// already gone
	}
}

/**
 * Remove an abandoned lock. Only one process at a time may break a lock (it
 * holds `<lock>.break`), and it re-checks the lock while holding that marker.
 * A live holder's lock is never removed, so no two processes can hold it.
 */
function breakAbandonedLock(lockPath: string, staleMs: number): void {
	const marker = `${lockPath}.break`;
	if (!tryCreate(marker)) {
		const breaker = readLockInfo(marker);
		if (
			breaker &&
			(Date.now() - breaker.mtimeMs > BREAK_MARKER_STALE_MS ||
				(Number.isFinite(breaker.pid) && !isProcessAlive(breaker.pid)))
		) {
			removeQuietly(marker);
		}
		return;
	}
	try {
		const info = readLockInfo(lockPath);
		if (info && isAbandoned(info, staleMs)) removeQuietly(lockPath);
	} finally {
		removeQuietly(marker);
	}
}

/**
 * Cross-process mutex backed by an exclusively-created lock file holding the
 * owner's pid. Resolves to a release function. Locks left by crashed
 * processes are taken over.
 */
export async function acquireFileLock(
	lockPath: string,
	options: FileLockOptions = {},
): Promise<() => void> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	const staleMs = options.staleMs ?? 10 * 60_000;
	const pollMs = options.pollMs ?? 50;
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		if (tryCreate(lockPath)) {
			let released = false;
			return () => {
				if (released) return;
				released = true;
				// Nobody else removes a live holder's lock, so this is still ours.
				removeQuietly(lockPath);
			};
		}

		const current = readLockInfo(lockPath);
		if (current && isAbandoned(current, staleMs)) {
			breakAbandonedLock(lockPath, staleMs);
			continue;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for lock ${lockPath}`);
		}
		await Bun.sleep(pollMs);
	}
}
