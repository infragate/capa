import { existsSync } from 'fs';
import { resolve } from 'path';
import { getCapabilitiesPath } from '../../shared/paths';
import { createDefaultCapabilities, writeCapabilitiesFile } from '../../shared/capabilities';
import type { CapabilitiesFormat } from '../../types/capabilities';
import { ensureCapaDir } from '../../shared/config';
import { ensureServer } from '../utils/server-manager';

const CURRENT_VERSION = '1.0.0';

export async function initCommand(format: CapabilitiesFormat): Promise<void> {
  const projectPath = process.cwd();
  const capabilitiesPath = getCapabilitiesPath(projectPath, format);
  
  if (existsSync(capabilitiesPath)) {
    console.warn(`⚠ ${capabilitiesPath} already exists. Skipping initialization.`);
    return;
  }
  
  // Ensure .capa directory exists
  await ensureCapaDir();
  
  // Create default capabilities file
  const capabilities = createDefaultCapabilities();
  await writeCapabilitiesFile(capabilitiesPath, format, capabilities);
  
  console.log(`✓ Created ${capabilitiesPath}`);
  
  // Ensure server is running
  await ensureServer(CURRENT_VERSION);
}
