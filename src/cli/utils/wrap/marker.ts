import { existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import { WORKSPACE_MARKER, type WorkspaceMarker } from '../../../shared/workspaces/paths';

async function tryReadMarker(markerPath: string): Promise<WorkspaceMarker | null> {
  if (!existsSync(markerPath)) return null;
  try {
    const data = (await Bun.file(markerPath).json()) as WorkspaceMarker;
    if (!data?.realProjectPath || !data?.providerId) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * If cwd (or `dir`) is inside a capa wrap shadow workspace, return its marker.
 *
 * The marker lives on the **cache root** (parent of the nested project-named
 * working dir), so IDE users never see `.capa-workspace.json` in the tree.
 */
export async function readWorkspaceMarker(
  dir: string = process.cwd(),
): Promise<WorkspaceMarker | null> {
  const abs = resolve(dir);

  // Primary: parent cache root (marker is one level above the working dir).
  const parentMarker = await tryReadMarker(join(abs, '..', WORKSPACE_MARKER));
  if (parentMarker) {
    const expected =
      parentMarker.workingDir ?? basename(resolve(parentMarker.realProjectPath));
    if (basename(abs) === expected || !parentMarker.workingDir) {
      return parentMarker;
    }
  }

  // Legacy / direct open of the cache root itself.
  return tryReadMarker(join(abs, WORKSPACE_MARKER));
}

/**
 * Refuse to run project-mutating commands inside a wrap workspace.
 * Returns true and prints an error if the current directory is a wrap workspace.
 */
export async function refuseIfWrapWorkspace(command: string): Promise<boolean> {
  const marker = await readWorkspaceMarker();
  if (!marker) return false;
  console.error(
    `✗ Cannot run "capa ${command}" inside a wrap workspace.\n` +
      `  Run it from the real project instead:\n` +
      `  ${marker.realProjectPath}`,
  );
  return true;
}
