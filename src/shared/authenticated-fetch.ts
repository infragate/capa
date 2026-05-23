/**
 * Authenticated Fetch Helper for Private Repositories
 * 
 * Provides fetch helpers that automatically add authentication headers
 * for GitHub and GitLab based on stored credentials.
 */

import type { CapaDatabase } from '../db/database';
import type { GitIntegration } from '../types/database';
import type { GitPlatform } from '../types/git-integration';
import { getGitProvider, getGitProviderByHost } from './git-providers/registry';

const CLOUD_OAUTH_ENDPOINT = 'https://capa.infragate.ai/auth';

const TOKEN_EXPIRED_MESSAGE =
  'Git integration token has expired. Run `capa auth` again to re-authenticate.';

function getExpiresAt(integration: GitIntegration): number | null {
  const row = integration as GitIntegration & { expiresAt?: number | null };
  return integration.expires_at ?? row.expiresAt ?? null;
}

function isTokenExpired(integration: GitIntegration): boolean {
  const expiresAt = getExpiresAt(integration);
  return expiresAt !== null && expiresAt < Date.now();
}

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

      const provider = getGitProviderByHost(host);
      if (provider) {
        return { platform: provider.id as GitPlatform };
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

  private canRefresh(platform: GitPlatform): boolean {
    return !!getGitProvider(platform);
  }

  /**
   * Refresh an expired OAuth token via the cloud endpoint and persist to the DB.
   */
  private async refreshAccessToken(
    platform: GitPlatform,
    host: string | undefined,
    integration: GitIntegration
  ): Promise<boolean> {
    if (!integration.refresh_token || !this.canRefresh(platform)) {
      return false;
    }

    try {
      const gp = getGitProvider(platform);
      if (!gp) return false;

      const response = await fetch(`${CLOUD_OAUTH_ENDPOINT}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: gp.cloudOAuthProviderParam,
          refresh_token: integration.refresh_token,
        }),
      });
      if (!response.ok) {
        this.db.deleteGitIntegration(platform, host ?? null);
        return false;
      }

      const tokenData = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
        expires_in?: number;
      };

      if (!tokenData.access_token) {
        return false;
      }

      const expiresAt = tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : null;

      this.db.setGitIntegration(platform, {
        host: host ?? null,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || integration.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: expiresAt,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the integration has a non-expired token, refreshing when possible.
   */
  private async ensureFreshIntegration(
    platform: GitPlatform,
    host: string | undefined,
    integration: GitIntegration
  ): Promise<GitIntegration> {
    if (!isTokenExpired(integration)) {
      return integration;
    }

    const refreshed = await this.refreshAccessToken(platform, host, integration);
    if (refreshed) {
      const updated = this.db.getGitIntegration(platform, host ?? null);
      if (updated && !isTokenExpired(updated)) {
        return updated;
      }
    }

    throw new Error(TOKEN_EXPIRED_MESSAGE);
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

    const fresh = await this.ensureFreshIntegration(platform, host, integration);

    const gp = getGitProvider(platform);
    if (gp) {
      return {
        'Authorization': gp.authHeader(fresh.access_token),
      };
    }

    // Self-managed instances
    if (platform === 'github-enterprise') {
      return {
        'Authorization': `token ${fresh.access_token}`,
      };
    }

    return {
      'Authorization': `Bearer ${fresh.access_token}`,
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
    
    return !!integration && !isTokenExpired(integration);
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
    
    if (!integration || isTokenExpired(integration)) {
      return null;
    }

    return integration.access_token;
  }

  /**
   * Check if a URL is for a private repository based on response
   * This should be called after a failed fetch attempt
   */
  static isPrivateRepoError(response: Response): boolean {
    return response.status === 401 || response.status === 403;
  }
}

/**
 * Create an authenticated fetch helper
 * This is a convenience function for creating an AuthenticatedFetch instance
 */
export function createAuthenticatedFetch(db: CapaDatabase): AuthenticatedFetch {
  return new AuthenticatedFetch(db);
}
