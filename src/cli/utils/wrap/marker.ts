import { existsSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
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

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

/**
 * If cwd (or `dir`) is inside a capa wrap shadow workspace, return its marker.
 *
 * The marker lives on the **cache root** (parent of the nested project-named
 * working dir), so IDE users never see `.capa-workspace.json` in the tree.
 * Walks ancestors so `capa install/add/clean` from a subdirectory still refuse.
 */
export async function readWorkspaceMarker(
  dir: string = process.cwd(),
): Promise<WorkspaceMarker | null> {
  let abs = resolve(dir);
  const seen = new Set<string>();

  while (!seen.has(abs)) {
    seen.add(abs);

    const marker = await tryReadMarker(join(abs, WORKSPACE_MARKER));
    if (marker) {
      const workingDir = marker.workingDir;
      if (!workingDir) {
        // Legacy flat layout: marker dir is the workspace root.
        if (isPathInside(resolve(dir), abs)) return marker;
      } else {
        const nestedRoot = join(abs, workingDir);
        // Current dir is the cache root, the nested working dir, or inside it.
        if (abs === resolve(dir) || isPathInside(resolve(dir), nestedRoot)) {
          return marker;
        }
      }
    }

    const parent = dirname(abs);
    if (parent === abs) break;
    abs = parent;
  }

  return null;
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

/**
 * Path used for project identity (DB id / MCP endpoint).
 * Inside a wrap workspace this is the real project path; otherwise `dir`.
 */
export async function resolveProjectIdentityPath(
  dir: string = process.cwd(),
): Promise<string> {
  const marker = await readWorkspaceMarker(dir);
  if (marker?.realProjectPath) return resolve(marker.realProjectPath);
  return resolve(dir);
}
