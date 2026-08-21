import { existsSync, realpathSync } from 'fs';
import { join, relative } from 'path';

/**
 * Reject agent instruction sources that resolve to the same file capa writes
 * (e.g. `agents.base: .workflows/WORKFLOW.md` symlinked to `AGENTS.md`).
 * That creates a feedback loop: each sync appends the managed file to itself.
 */
export function assertAgentSourceNotInstructionsTarget(
  projectPath: string,
  sourcePath: string,
  targetFilenames: string[],
  sourceLabel: string,
): void {
  let sourceReal: string;
  try {
    sourceReal = realpathSync(sourcePath);
  } catch {
    return;
  }

  for (const filename of targetFilenames) {
    const targetPath = join(projectPath, filename);
    if (!existsSync(targetPath)) continue;

    let targetReal: string;
    try {
      targetReal = realpathSync(targetPath);
    } catch {
      continue;
    }

    if (sourceReal !== targetReal) continue;

    const relSource = relative(projectPath, sourcePath) || sourcePath;
    throw new Error(
      `${sourceLabel} "${relSource}" resolves to the same file as ${filename}. ` +
        `capa writes managed blocks into ${filename}; using it (or a symlink to it) as a ` +
        `source creates a feedback loop that bloats the file on every sync. ` +
        `Use a separate source file, or remove agents.base and keep ${filename} user-owned.`,
    );
  }
}
