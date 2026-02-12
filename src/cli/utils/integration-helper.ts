/**
 * Integration Helper Utilities
 * 
 * Provides helper functions for detecting and prompting users
 * to set up Git integrations when accessing private repositories.
 */

import type { CapaDatabase } from '../../db/database';

/**
 * Extract platform and repo info from a GitHub or GitLab URL
 */
export function parseRepoUrl(url: string): {
  platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed' | null;
  host: string;
  owner: string;
  repo: string;
} | null {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const pathParts = urlObj.pathname.split('/').filter(p => p);

    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1].replace(/\.git$/, '');

    let platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed' | null = null;

    if (host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'api.github.com') {
      platform = 'github';
    } else if (host === 'gitlab.com') {
      platform = 'gitlab';
    } else {
      // Could be self-managed - caller should check if it's configured
      return {
        platform: null,
        host,
        owner,
        repo,
      };
    }

    return {
      platform,
      host,
      owner,
      repo,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check if a repo URL requires authentication
 * @param url Repository URL
 * @param db Database instance to check for existing integrations
 * @returns true if authentication is needed but not configured
 */
export async function requiresAuthentication(url: string, db: CapaDatabase): Promise<boolean> {
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return false;
  }

  const { platform, host } = parsed;
  
  // Check if we have authentication configured
  if (platform) {
    const integration = db.getGitIntegration(platform, host);
    if (integration) {
      return false; // We have auth, no need to prompt
    }
  }

  // Try to fetch without auth first
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.status === 401 || response.status === 403 || response.status === 404;
  } catch (error) {
    // Network error, can't determine
    return false;
  }
}

/**
 * Get the URL for setting up integrations
 * @param serverHost The CAPA server host
 * @param serverPort The CAPA server port
 * @returns URL to the integrations page
 */
export function getIntegrationsUrl(serverHost: string = '127.0.0.1', serverPort: number = 5912): string {
  return `http://${serverHost}:${serverPort}/ui/integrations`;
}

/**
 * Display a user-friendly prompt to set up integration
 * @param platform The platform that needs authentication
 * @param integrationsUrl URL to the integrations page
 */
export function displayIntegrationPrompt(platform: string, integrationsUrl: string): void {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠  Authentication Required');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  This appears to be a private ${platform} repository.`);
  console.log('  To access private repositories, you need to set up authentication.');
  console.log('');
  console.log('  Please visit:');
  console.log(`  ${integrationsUrl}`);
  console.log('');
  console.log('  Then run this command again.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

/**
 * Display a success message after setting up authentication
 */
export function displayIntegrationSuccess(platform: string): void {
  console.log('');
  console.log(`✓ Successfully connected to ${platform}`);
  console.log('  You can now access private repositories.');
  console.log('');
}
