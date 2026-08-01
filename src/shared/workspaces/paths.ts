import { isAbsolute, join, relative, resolve } from "path";
import { getCapaDir } from "../config";

/** Marker filename written into every wrap shadow workspace. */
export const WORKSPACE_MARKER = ".capa-workspace.json";

export function getWorkspacesDir(): string {
	return join(getCapaDir(), "workspaces");
}

/**
 * True when `dir` is under `~/.capa/workspaces` (wrap shadow cache tree).
 * Used as a belt-and-suspenders guard when the workspace marker is missing.
 *
 * Uses `path.relative` (case-insensitive on Windows) rather than string
 * `startsWith`, so `C:\...` vs `c:\...` cannot bypass the guard.
 */
export function isUnderWrapWorkspacesDir(dir: string): boolean {
	const workspaces = resolve(getWorkspacesDir());
	const abs = resolve(dir);
	const rel = relative(workspaces, abs);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface WorkspaceMarker {
	realProjectPath: string;
	providerId: string;
	createdAt: string;
	/** Fingerprinted cache root that holds this marker (same directory as the file). */
	cachePath?: string;
	/** Nested working directory name under the cache root (IDE/agent cwd). */
	workingDir?: string;
	/**
	 * Hash of capabilities.yaml + semantic lock pins at last wrap install.
	 * Used to decide whether to reinstall in-place; not part of the cache path.
	 */
	capabilitiesFingerprint?: string;
}
