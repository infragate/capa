import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { header, footer, info, warn, error } from '../ui';
import { refuseIfWrapWorkspace } from '../utils/wrap/marker';
import { cleanProject } from './clean-project';

export async function cleanCommand(): Promise<void> {
  if (await refuseIfWrapWorkspace('clean')) {
    process.exit(1);
  }

  const projectPath = process.cwd();

  header('Clean project');

  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    error('No capabilities file found.');
    process.exit(1);
  }

  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format,
  );

  const projectId = generateProjectId(projectPath);
  info(`Project ID: ${projectId}`);

  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);

  try {
    const result = await cleanProject({
      projectPath,
      projectId,
      db,
      capabilities,
    });

    if (result.wrapSessionsStopped > 0) {
      info(
        `Stopped ${result.wrapSessionsStopped} wrap session process${
          result.wrapSessionsStopped === 1 ? '' : 'es'
        }`,
      );
    }
    if (result.managedFilesRemoved > 0) {
      info(
        `Removed ${result.managedFilesRemoved} managed file${
          result.managedFilesRemoved === 1 ? '' : 's'
        }`,
      );
    }
    if (result.workspacesPruned > 0) {
      info(
        `Pruned ${result.workspacesPruned} wrap workspace${
          result.workspacesPruned === 1 ? '' : 's'
        }`,
      );
    }
    if (result.warnings.length === 0 && result.managedFilesRemoved === 0) {
      // Providers may still have been cleaned; keep messaging light.
    }
    for (const w of result.warnings) {
      warn(w);
    }
    footer('Cleanup complete!');
  } finally {
    db.close();
  }
}
