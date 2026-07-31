import { join } from 'path';
import { getCapaDir } from '../config';

/** Marker filename written into every wrap shadow workspace. */
export const WORKSPACE_MARKER = '.capa-workspace.json';

export function getWorkspacesDir(): string {
  return join(getCapaDir(), 'workspaces');
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
