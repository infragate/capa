import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { generateProjectId } from '../../shared/paths';
import { projectUiUrl } from '../../shared/ui-urls';
import { VERSION } from '../../version';
import { isHeadless } from '../ui';
import { ensureServer } from '../utils/server-manager';
import { openBrowser } from './install-tasks/helpers/browser';

/** The project's page when `projectPath` is a known project, else the dashboard home. */
export function resolveDashboardUrl(
  serverUrl: string,
  projectPath: string,
  db: Pick<CapaDatabase, 'getProject'>,
): string {
  const projectId = generateProjectId(projectPath);
  if (db.getProject(projectId)) {
    return projectUiUrl(serverUrl, projectId);
  }
  return `${serverUrl.replace(/\/$/, '')}/`;
}

export async function openCommand(projectPath = '.'): Promise<void> {
  const status = await ensureServer(VERSION);
  if (!status.running || !status.url) {
    console.error('Failed to start the capa server');
    process.exit(1);
  }

  const db = new CapaDatabase(getDatabasePath(await loadSettings()));
  let url: string;
  try {
    url = resolveDashboardUrl(status.url, projectPath, db);
  } finally {
    db.close();
  }

  console.log(url);
  if (!isHeadless() && !(await openBrowser(url))) {
    console.error('Could not open a browser; open the URL above manually.');
  }
}
