import { createHash } from "crypto";
import { readFileSync } from "fs";
import { loadLockfile, lockfileSemanticKey } from "./lockfile";
import { detectCapabilitiesFile } from "./paths";

/**
 * Fingerprint of what `capa install` installed: the capabilities file and the
 * lockfile's pins (not its timestamp). Stored per project after an install so
 * `capa status` can tell when the project needs installing again (#332).
 * Format: `v1:<capabilities hash>:<lockfile hash>`.
 */
export async function computeInstallFingerprint(
	projectPath: string,
): Promise<string | null> {
	const file = await detectCapabilitiesFile(projectPath);
	if (!file) return null;
	// Line endings only: a checkout with different autocrlf isn't an edit.
	const capabilities = readFileSync(file.path, "utf8").replace(/\r\n/g, "\n");
	let lock: string;
	try {
		const lockfile = await loadLockfile(projectPath);
		lock = lockfile ? lockfileSemanticKey(lockfile) : "";
	} catch {
		lock = "unreadable";
	}
	return `v1:${sha256(capabilities)}:${sha256(lock)}`;
}

/** Which part of a project changed since the recorded fingerprint. */
export function fingerprintChanges(
	installed: string,
	current: string,
): Array<"capabilities" | "lockfile"> {
	const [, capsA, lockA] = installed.split(":");
	const [, capsB, lockB] = current.split(":");
	const changes: Array<"capabilities" | "lockfile"> = [];
	if (capsA !== capsB) changes.push("capabilities");
	if (lockA !== lockB) changes.push("lockfile");
	return changes;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
