import { resolve, basename } from 'path';
import { createHash } from 'crypto';

/**
 * Generate a project ID from a directory path.
 * Format: {directory-name}-{4-char-hash}
 */
export function generateProjectId(projectPath: string): string {
  const absPath = resolve(projectPath);
  const dirName = basename(absPath);
  
  // Create hash of full path
  const hash = createHash('sha256')
    .update(absPath)
    .digest('hex')
    .substring(0, 4);
  
  // Sanitize directory name for use in URL
  const sanitizedName = dirName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  return `${sanitizedName}-${hash}`;
}

/**
 * Get the capabilities file path for a project
 */
export function getCapabilitiesPath(projectPath: string, format: 'json' | 'yaml'): string {
  return resolve(projectPath, `capabilities.${format}`);
}

/**
 * Detect which capabilities file exists in the project.
 * Throws an error if both capabilities.yaml and capabilities.json exist.
 * Returns null if no capabilities file is found.
 * 
 * @throws Error if both YAML and JSON capabilities files exist
 */
export async function detectCapabilitiesFile(projectPath: string): Promise<{ path: string; format: 'json' | 'yaml' } | null> {
  const jsonPath = getCapabilitiesPath(projectPath, 'json');
  const yamlPath = getCapabilitiesPath(projectPath, 'yaml');
  
  const jsonExists = await existsAsync(jsonPath);
  const yamlExists = await existsAsync(yamlPath);
  
  // Error if both files exist
  if (jsonExists && yamlExists) {
    throw new Error(
      'Both capabilities.yaml and capabilities.json found. Please keep only one capabilities file.'
    );
  }
  
  // Check for YAML first (default format)
  if (yamlExists) {
    return { path: yamlPath, format: 'yaml' };
  }
  
  // Then check for JSON
  if (jsonExists) {
    return { path: jsonPath, format: 'json' };
  }
  
  return null;
}

async function existsAsync(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}
