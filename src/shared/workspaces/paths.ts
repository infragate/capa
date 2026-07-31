import { join, resolve, sep } from 'path';
import { getCapaDir } from '../config';

/** Marker filename written into every wrap shadow workspace. */
export const WORKSPACE_MARKER = '.capa-workspace.json';

export function getWorkspacesDir(): string {
  return join(getCapaDir(), 'workspaces');
}

/**
 * True when `dir` is under `~/.capa/workspaces` (wrap shadow cache tree).
 * Used as a belt-and-suspenders guard when the workspace marker is missing.
 */
export function isUnderWrapWorkspacesDir(dir: string): boolean {
  const workspaces = resolve(getWorkspacesDir());
  const abs = resolve(dir);
  if (abs === workspaces) return true;
  const rootWithSep = workspaces.endsWith(sep) ? workspaces : workspaces + sep;
  return abs.startsWith(rootWithSep);
}

export interface WorkspaceMarker {
  realProjectPath: string;
  providerId: string;
  createdAt: string;
  /** Fingerprinted cache root that holds this marker (same directory as the file). */
  cachePath?: string;
  /** Nested working directory name under the cache root (IDE/agent cwd). */
  workingDir?: string;
}
