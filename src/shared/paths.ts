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
 * Detect which capabilities file exists in the project
 */
export function detectCapabilitiesFile(projectPath: string): { path: string; format: 'json' | 'yaml' } | null {
  const jsonPath = getCapabilitiesPath(projectPath, 'json');
  const yamlPath = getCapabilitiesPath(projectPath, 'yaml');
  
  if (existsSync(jsonPath)) {
    return { path: jsonPath, format: 'json' };
  }
  
  if (existsSync(yamlPath)) {
    return { path: yamlPath, format: 'yaml' };
  }
  
  return null;
}

function existsSync(path: string): boolean {
  try {
    return Bun.file(path).size >= 0;
  } catch {
    return false;
  }
}
