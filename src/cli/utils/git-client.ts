// Authenticated Git HTTP client for fetching files from GitHub/GitLab

import type { CapaDatabase } from '../../db/database';
import { extractProvider, isGitUrl } from './git-url-parser';
import { ensureServer } from './server-manager';
import { VERSION } from '../../version';

export interface GitFetchOptions {
  url: string;
  provider?: string;  // Auto-detected if not provided
  headers?: Record<string, string>;
}

export interface GitClientOptions {
  db: CapaDatabase;
  serverUrl?: string;
}

/**
 * Authenticated HTTP client for Git API/raw requests
 * Automatically handles OAuth authentication for private repositories
 */
export class GitHttpClient {
  private db: CapaDatabase;
  private serverUrl?: string;
  
  constructor(options: GitClientOptions) {
    this.db = options.db;
    this.serverUrl = options.serverUrl;
  }

  /**
   * Fetch a resource from a Git provider with automatic authentication
   */
  async fetch(options: GitFetchOptions): Promise<Response> {
    const { url, headers = {} } = options;
    
    // Check if this is a Git URL
    if (!isGitUrl(url)) {
      // Not a Git URL, use regular fetch
      return await fetch(url, { headers });
    }

    // Detect provider
    const provider = options.provider || extractProvider(url);
    if (!provider) {
      // Can't determine provider, use regular fetch
      return await fetch(url, { headers });
    }

    // Try fetching without authentication first
    let response = await fetch(url, { headers });

    // Check if authentication is required
    if (this.detectAuthRequired(response)) {
      console.log(`🔒 Private repository detected: ${provider}`);
      
      // Try to get existing token
      const token = this.db.getGitOAuthToken(provider);
      
      if (token) {
        // We have a token, retry with authentication
        response = await this.fetchWithAuth(provider, url, headers, token.access_token);
        
        // If still unauthorized, token might be invalid/expired
        if (this.detectAuthRequired(response)) {
          // Try to refresh the token first
          console.log('🔄 Access token expired, attempting refresh...');
          const refreshed = await this.tryRefreshToken(provider);
          
          if (refreshed) {
            // Get refreshed token and retry
            const refreshedToken = this.db.getGitOAuthToken(provider);
            if (refreshedToken) {
              response = await this.fetchWithAuth(provider, url, headers, refreshedToken.access_token);
              
              // If still failing after refresh, re-authenticate
              if (this.detectAuthRequired(response)) {
                console.log('⚠️  Token refresh succeeded but access still denied, re-authenticating...');
                const success = await this.triggerOAuthFlow(provider);
                if (success) {
                  const newToken = this.db.getGitOAuthToken(provider);
                  if (newToken) {
                    response = await this.fetchWithAuth(provider, url, headers, newToken.access_token);
                  }
                }
              } else {
                console.log('✓ Token refreshed successfully');
              }
            }
          } else {
            // Refresh failed, trigger full OAuth flow
            console.log('⚠️  Token refresh failed, re-authenticating...');
            const success = await this.triggerOAuthFlow(provider);
            if (success) {
              const newToken = this.db.getGitOAuthToken(provider);
              if (newToken) {
                response = await this.fetchWithAuth(provider, url, headers, newToken.access_token);
              }
            }
          }
        }
      } else {
        // No token, trigger OAuth flow
        const success = await this.triggerOAuthFlow(provider);
        if (success) {
          // Get token and retry
          const newToken = this.db.getGitOAuthToken(provider);
          if (newToken) {
            response = await this.fetchWithAuth(provider, url, headers, newToken.access_token);
          }
        }
      }
    }

    return response;
  }

  /**
   * Fetch with authentication header
   */
  private async fetchWithAuth(provider: string, url: string, headers: Record<string, string>, accessToken: string): Promise<Response> {
    const authHeaders = {
      ...headers,
      'Authorization': `Bearer ${accessToken}`,
    };

    // GitHub uses different header for raw content
    if (provider === 'github.com' && url.includes('raw.githubusercontent.com')) {
      authHeaders['Authorization'] = `token ${accessToken}`;
    }

    return await fetch(url, { headers: authHeaders });
  }

  /**
   * Detect if authentication is required based on response
   */
  private detectAuthRequired(response: Response): boolean {
    // 401 Unauthorized or 403 Forbidden indicates auth is needed
    return response.status === 401 || response.status === 403;
  }

  /**
   * Try to refresh an expired token
   */
  private async tryRefreshToken(provider: string): Promise<boolean> {
    try {
      // Check if we have a refresh token
      const token = this.db.getGitOAuthToken(provider);
      if (!token || !token.refresh_token) {
        return false;
      }

      // Ensure server is running
      if (!this.serverUrl) {
        const serverStatus = await ensureServer(VERSION);
        if (!serverStatus.running || !serverStatus.url) {
          return false;
        }
        this.serverUrl = serverStatus.url;
      }

      // Call server API to refresh token
      const platformName = provider === 'github.com' ? 'github' : 'gitlab';
      const refreshResponse = await fetch(`${this.serverUrl}/api/integrations/${platformName}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!refreshResponse.ok) {
        return false;
      }

      const result = await refreshResponse.json();
      return result.success === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Trigger OAuth flow for a provider
   */
  private async triggerOAuthFlow(provider: string): Promise<boolean> {
    try {
      // Ensure server is running
      if (!this.serverUrl) {
        console.log('🚀 Starting CAPA server...');
        const serverStatus = await ensureServer(VERSION);
        if (!serverStatus.running || !serverStatus.url) {
          console.error('✗ Failed to start server');
          return false;
        }
        this.serverUrl = serverStatus.url;
      }

      console.log('🌐 Opening browser for authentication...');

      // Initiate OAuth flow via server API
      const authResponse = await fetch(`${this.serverUrl}/api/git-auth/${encodeURIComponent(provider)}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!authResponse.ok) {
        console.error('✗ Failed to initiate OAuth flow');
        return false;
      }

      const { authUrl } = await authResponse.json();

      // Open browser
      const opened = await this.openBrowser(`${this.serverUrl}/ui/git-auth?provider=${encodeURIComponent(provider)}`);
      if (!opened) {
        console.log(`\n⚠️  Please open this URL in your browser:`);
        console.log(`   ${this.serverUrl}/ui/git-auth?provider=${encodeURIComponent(provider)}`);
      }

      // Poll for completion
      console.log('⏳ Waiting for authorization...');
      const success = await this.pollForCompletion(provider, 300); // 5 minute timeout

      if (success) {
        console.log('✓ Authentication successful!');
        return true;
      } else {
        console.error('✗ Authentication failed or timed out');
        return false;
      }
    } catch (error: any) {
      console.error(`✗ OAuth flow error: ${error.message}`);
      return false;
    }
  }

  /**
   * Poll server for OAuth completion
   */
  private async pollForCompletion(provider: string, timeoutSeconds: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      // Check if token exists in database
      const token = this.db.getGitOAuthToken(provider);
      if (token) {
        return true;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  /**
   * Open browser to URL
   */
  private async openBrowser(url: string): Promise<boolean> {
    try {
      const platform = process.platform;
      let command: string;

      if (platform === 'darwin') {
        command = `open "${url}"`;
      } else if (platform === 'win32') {
        command = `start "" "${url}"`;
      } else {
        command = `xdg-open "${url}"`;
      }

      const proc = Bun.spawn(command.split(' '), {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      });

      await proc.exited;
      return proc.exitCode === 0;
    } catch (error) {
      return false;
    }
  }
}
