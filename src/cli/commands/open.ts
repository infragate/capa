import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { generateProjectId } from '../../shared/paths';
import { projectUiUrl } from '../../shared/ui-urls';
import { VERSION } from '../../version';
import { isHeadless } from '../ui';
import { ensureServer } from '../utils/server-manager';
import { resolveProjectIdentityPath } from '../utils/wrap/marker';
import { openBrowser } from './install-tasks/helpers/browser';

/** The project's page when `projectPath` is a known project, else the dashboard home. */
export async function resolveDashboardUrl(
  serverUrl: string,
  projectPath: string,
  db: Pick<CapaDatabase, 'getProject'>,
): Promise<string> {
  const home = `${serverUrl.replace(/\/$/, '')}/`;
  // Inside a wrap shadow workspace the project is registered under its real path.
  // A workspace without a marker can't be mapped back, so just open home.
  const idPath = await resolveProjectIdentityPath(projectPath).catch(() => null);
  if (!idPath) return home;
  const projectId = generateProjectId(idPath);
  return db.getProject(projectId) ? projectUiUrl(serverUrl, projectId) : home;
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
    url = await resolveDashboardUrl(status.url, projectPath, db);
  } finally {
    db.close();
  }

  console.log(url);
  if (!isHeadless() && !(await openBrowser(url))) {
    console.error('Could not open a browser; open the URL above manually.');
  }
}
