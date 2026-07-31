import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  detectCapabilitiesFile,
  generateProjectId,
  getCapabilitiesPath,
} from '../../shared/paths';
import {
  createDefaultCapabilities,
  parseCapabilitiesFile,
  writeCapabilitiesFile,
} from '../../shared/capabilities';
import type { Capabilities, CapabilitiesFormat } from '../../types/capabilities';
import { ensureCapaDir, loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { isUnderWrapWorkspacesDir } from '../../shared/workspaces/paths';
import { ensureServer } from '../utils/server-manager';
import { refuseIfWrapWorkspace } from '../utils/wrap/marker';
import { VERSION } from '../../version';

async function registerProject(
  projectPath: string,
  capabilities: Capabilities,
  serverUrl: string,
): Promise<string> {
  const identityPath = resolve(projectPath);
  if (isUnderWrapWorkspacesDir(identityPath)) {
    throw new Error(
      `Refusing to register wrap workspace path as a project: ${identityPath}`,
    );
  }

  const projectId = generateProjectId(identityPath);
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  try {
    const existing = db.getProject(projectId);
    if (existing) {
      const existingPath = resolve(existing.path);
      const samePath =
        process.platform === 'win32'
          ? existingPath.toLowerCase() === identityPath.toLowerCase()
          : existingPath === identityPath;
      if (!samePath) {
        throw new Error(
          `Project id "${projectId}" is already registered at a different path:\n` +
            `  existing: ${existing.path}\n` +
            `  this:     ${identityPath}\n` +
            `Remove the conflicting project or reinstall from the correct directory.`,
        );
      }
    } else {
      db.upsertProject({ id: projectId, path: identityPath });
    }
  } finally {
    db.close();
  }

  const response = await fetch(
    `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/configure`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(capabilities),
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to configure project: ${text}`);
  }
  await response.text().catch(() => '');
  return projectId;
}

export async function initCommand(format: CapabilitiesFormat): Promise<void> {
  if (await refuseIfWrapWorkspace('init')) {
    process.exit(1);
  }

  const projectPath = process.cwd();
  const capabilitiesPath = getCapabilitiesPath(projectPath, format);

  await ensureCapaDir();

  let capabilities: Capabilities;
  let created = false;

  if (existsSync(capabilitiesPath)) {
    console.warn(`⚠ ${capabilitiesPath} already exists. Skipping file creation.`);
    const detected = await detectCapabilitiesFile(projectPath);
    if (!detected) {
      // File exists at the requested format path but detect failed — parse directly.
      capabilities = await parseCapabilitiesFile(capabilitiesPath, format);
    } else {
      capabilities = await parseCapabilitiesFile(detected.path, detected.format);
    }
  } else {
    capabilities = createDefaultCapabilities();
    await writeCapabilitiesFile(capabilitiesPath, format, capabilities);
    console.log(`✓ Created ${capabilitiesPath}`);
    created = true;
  }

  const serverStatus = await ensureServer(VERSION);
  if (!serverStatus.running || !serverStatus.url) {
    console.error('✗ Failed to start capa server');
    process.exit(1);
  }

  try {
    const projectId = await registerProject(projectPath, capabilities, serverStatus.url);
    console.log(
      created
        ? `✓ Registered project ${projectId}`
        : `✓ Registered project ${projectId} (capabilities file unchanged)`,
    );
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
