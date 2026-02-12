/**
 * Authenticated Fetch Helper for Private Repositories
 * 
 * Provides fetch helpers that automatically add authentication headers
 * for GitHub and GitLab based on stored credentials.
 */

import type { CapaDatabase } from '../db/database';
import type { GitPlatform } from '../types/git-integration';

export class AuthenticatedFetch {
  private db: CapaDatabase;

  constructor(db: CapaDatabase) {
    this.db = db;
  }

  /**
   * Detect the platform from a URL
   */
  private detectPlatform(url: string): { platform: GitPlatform; host?: string } | null {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname;

      if (host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'api.github.com') {
        return { platform: 'github' };
      }

      if (host === 'gitlab.com') {
        return { platform: 'gitlab' };
      }

      // Check for self-managed instances
      const integrations = this.db.getAllGitIntegrations();
      
      for (const integration of integrations) {
        if (integration.host && host === integration.host) {
          return {
            platform: integration.platform as GitPlatform,
            host: integration.host,
          };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get authentication headers for a URL
   */
  private async getAuthHeaders(url: string): Promise<Record<string, string> | null> {
    const detected = this.detectPlatform(url);
    if (!detected) {
      return null;
    }

    const { platform, host } = detected;
    const integration = this.db.getGitIntegration(platform, host || null);
    
    if (!integration) {
      return null;
    }

    // Check if token is expired (for OAuth platforms)
    if (integration.expires_at && integration.expires_at < Date.now()) {
      // Token expired, return null to trigger re-authentication
      return null;
    }

    // GitHub and GitHub Enterprise use "token" prefix
    if (platform === 'github' || platform === 'github-enterprise') {
      return {
        'Authorization': `token ${integration.access_token}`,
      };
    }

    // GitLab uses "Bearer" prefix
    return {
      'Authorization': `Bearer ${integration.access_token}`,
    };
  }

  /**
   * Perform an authenticated fetch request
   * @param url The URL to fetch
   * @param options Standard fetch options
   * @returns Response object
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const authHeaders = await this.getAuthHeaders(url);
    
    const headers = new Headers(options.headers || {});
    
    if (authHeaders) {
      for (const [key, value] of Object.entries(authHeaders)) {
        headers.set(key, value);
      }
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  /**
   * Check if authentication is available for a URL
   */
  hasAuth(url: string): boolean {
    const detected = this.detectPlatform(url);
    if (!detected) {
      return false;
    }

    const { platform, host } = detected;
    const integration = this.db.getGitIntegration(platform, host || null);
    
    return !!integration;
  }

  /**
   * Get the access token for a URL (for use in git clone)
   * @param url The URL to get the token for
   * @returns The access token or null if not available
   */
  getTokenForUrl(url: string): string | null {
    const detected = this.detectPlatform(url);
    if (!detected) {
      return null;
    }

    const { platform, host } = detected;
    const integration = this.db.getGitIntegration(platform, host || null);
    
    return integration?.access_token || null;
  }

  /**
   * Check if a URL is for a private repository based on response
   * This should be called after a failed fetch attempt
   */
  static isPrivateRepoError(response: Response): boolean {
    return response.status === 401 || response.status === 403 || response.status === 404;
  }
}

/**
 * Create an authenticated fetch helper
 * This is a convenience function for creating an AuthenticatedFetch instance
 */
export function createAuthenticatedFetch(db: CapaDatabase): AuthenticatedFetch {
  return new AuthenticatedFetch(db);
}
