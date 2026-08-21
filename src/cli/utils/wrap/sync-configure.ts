import { parseCapabilitiesFile } from '../../../shared/capabilities';
import { loadSettings, getDatabasePath } from '../../../shared/config';
import { detectCapabilitiesFile, generateProjectId } from '../../../shared/paths';
import { resolveProvidersForInstall } from '../../../shared/providers/resolve';
import { CapaDatabase } from '../../../db/database';
import { resolveWrapConfigureProviders } from '../../commands/install';
import { postProjectConfigure } from '../configure-project';

/**
 * Warm wrap reuses the shadow workspace without running install, so POST
 * /configure never runs and in-memory MCP server toggles stay off. Sync
 * enablement from the identity project's capabilities before launch.
 */
export async function syncWrapProjectConfigure(opts: {
  realProjectPath: string;
  wrapProviderId: string;
  serverUrl: string;
}): Promise<void> {
  const capsFile = await detectCapabilitiesFile(opts.realProjectPath);
  if (!capsFile) {
    throw new Error('No capabilities file found for wrap configure sync');
  }

  const capabilities = await parseCapabilitiesFile(capsFile.path, capsFile.format);
  const projectId = generateProjectId(opts.realProjectPath);
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  try {
    const authoredProviders = [...(capabilities.providers ?? [])];
    const resolvedProviders = await resolveProvidersForInstall({
      flagProvider: opts.wrapProviderId,
      capabilitiesProviders: capabilities.providers,
      db,
      projectId,
    });
    const configureProviders = resolveWrapConfigureProviders({
      authoredProviders,
      storedProviders: db.getProjectProviders(projectId),
      resolvedProviders,
    });

    await postProjectConfigure({
      serverUrl: opts.serverUrl,
      projectId,
      capabilities,
      configureProviders,
    });
  } finally {
    db.close();
  }
}
