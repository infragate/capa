// Git Integration Manager for GitHub and GitLab authentication
// Handles OAuth2 flows via cloud endpoint and Personal Access Token storage

import type { CapaDatabase } from '../db/database';
import type { GitPlatform, GitPATConfig } from '../types/git-integration';
import { logger } from '../shared/logger';

const CLOUD_OAUTH_ENDPOINT = 'https://capa.infragate.ai/auth';

export class GitIntegrationManager {
  private db: CapaDatabase;
  private logger = logger.child('GitIntegrationManager');
  private pendingFlows = new Map<string, { platform: GitPlatform; timestamp: number }>();

  constructor(db: CapaDatabase) {
    this.db = db;
  }

  /**
   * Check if a specific platform integration is configured
   */
  isConnected(platform: GitPlatform, host?: string): boolean {
    const integration = this.db.getGitIntegration(platform, host || null);
    return !!integration;
  }

  /**
   * Get all configured integrations
   */
  getAllIntegrations() {
    const integrations = this.db.getAllGitIntegrations();
    
    return integrations.map(integration => ({
      platform: integration.platform,
      host: integration.host || undefined,
      displayName: this.getPlatformDisplayName(integration.platform, integration.host),
      isConnected: true,
      expiresAt: integration.expires_at || undefined,
      usesOAuth: integration.platform === 'github' || integration.platform === 'gitlab',
    }));
  }

  /**
   * Generate authorization URL for OAuth2 flow (via cloud)
   * Returns the cloud OAuth endpoint URL that will handle the entire OAuth flow
   */
  async generateAuthorizationUrl(
    platform: 'github' | 'gitlab',
    localRedirectUri: string
  ): Promise<{ url: string; flowId: string }> {
    // Generate a unique flow ID to track this OAuth attempt
    const flowId = this.generateFlowId();
    
    // Store flow metadata
    this.pendingFlows.set(flowId, {
      platform,
      timestamp: Date.now(),
    });

    // Clean up old flows (older than 15 minutes)
    this.cleanupExpiredFlows();

    // Build cloud OAuth URL
    // The cloud will handle the OAuth flow and redirect back to our local server with the token
    const cloudUrl = new URL(CLOUD_OAUTH_ENDPOINT);
    cloudUrl.searchParams.set('provider', platform === 'github' ? 'github.com' : 'gitlab.com');
    cloudUrl.searchParams.set('redirect', localRedirectUri);

    const finalUrl = cloudUrl.toString();
    this.logger.info(`Generated cloud OAuth URL for ${platform}: ${finalUrl}`);
    this.logger.debug(`Flow ID: ${flowId}, Redirect URI: ${localRedirectUri}`);
    return { url: finalUrl, flowId };
  }

  /**
   * Handle OAuth2 callback - receive access token from cloud
   * The cloud OAuth handler already exchanged the code for a token
   */
  async handleCallback(
    accessToken: string,
    platformOrFlowId: 'github' | 'gitlab' | string | undefined,
    refreshToken?: string,
    expiresIn?: number
  ): Promise<{ success: boolean; platform?: GitPlatform; error?: string }> {
    try {
      this.logger.info(`OAuth callback received. Platform/FlowId: ${platformOrFlowId || 'none'}, Token length: ${accessToken.length}`);
      
      let platform: GitPlatform | undefined;
      
      // Check if it's a direct platform identifier
      if (platformOrFlowId === 'github' || platformOrFlowId === 'gitlab') {
        platform = platformOrFlowId;
        this.logger.debug(`Platform directly specified: ${platform}`);
      } 
      // Otherwise treat it as a flow ID
      else if (platformOrFlowId) {
        const flowData = this.pendingFlows.get(platformOrFlowId);
        if (flowData) {
          platform = flowData.platform;
          this.pendingFlows.delete(platformOrFlowId);
          this.logger.debug(`Found flow data for platform: ${platform}`);
        } else {
          this.logger.warn(`No flow data found for flow ID: ${platformOrFlowId}`);
        }
      }

      // If we still don't have a platform, try to determine it from the token
      if (!platform) {
        this.logger.info('Attempting to determine platform by testing token...');
        // Try GitHub first
        const githubTest = await this.testToken('github', accessToken);
        if (githubTest) {
          platform = 'github';
          this.logger.success('Token identified as GitHub');
        } else {
          // Try GitLab
          const gitlabTest = await this.testToken('gitlab', accessToken);
          if (gitlabTest) {
            platform = 'gitlab';
            this.logger.success('Token identified as GitLab');
          }
        }
      }

      if (!platform) {
        return { success: false, error: 'Unable to determine platform for access token' };
      }

      // Calculate expiration timestamp
      const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

      // Store token in database
      this.db.setGitIntegration(platform, {
        access_token: accessToken,
        refresh_token: refreshToken || null,
        token_type: 'Bearer',
        expires_at: expiresAt,
      });

      this.logger.success(`Token stored for ${platform}${refreshToken ? ' (with refresh token)' : ''}`);
      return { success: true, platform };
    } catch (error: any) {
      this.logger.failure(`Callback error: ${error.message}`);
      return { success: false, error: error.message || 'Token storage failed' };
    }
  }

  /**
   * Test if a token is valid for a given platform
   */
  private async testToken(platform: 'github' | 'gitlab', token: string): Promise<boolean> {
    try {
      const url = platform === 'github' 
        ? 'https://api.github.com/user'
        : 'https://gitlab.com/api/v4/user';
      
      const authHeader = platform === 'github'
        ? `token ${token}`
        : `Bearer ${token}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      this.logger.debug(`Token test failed for ${platform}: ${error}`);
      return false;
    }
  }

  /**
   * Store Personal Access Token for self-managed instances
   */
  async storePAT(config: GitPATConfig): Promise<void> {
    this.logger.info(`Storing PAT for ${config.platform} at ${config.host}`);
    
    // Validate the token by making a test API call
    const isValid = await this.validatePAT(config.platform, config.host, config.token);
    
    if (!isValid) {
      throw new Error('Invalid Personal Access Token. Please check your token and try again.');
    }

    this.db.setGitIntegration(config.platform, {
      host: config.host,
      access_token: config.token,
      token_type: 'token',
    });

    this.logger.success(`PAT stored for ${config.platform} at ${config.host}`);
  }

  /**
   * Validate a Personal Access Token
   */
  private async validatePAT(
    platform: 'github-enterprise' | 'gitlab-self-managed',
    host: string,
    token: string
  ): Promise<boolean> {
    try {
      const apiUrl = platform === 'github-enterprise'
        ? `https://${host}/api/v3/user`
        : `https://${host}/api/v4/user`;

      const authHeader = platform === 'github-enterprise'
        ? `token ${token}`
        : `Bearer ${token}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      this.logger.debug(`PAT validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Get access token for a platform
   * Automatically refreshes expired tokens if refresh token is available
   */
  async getAccessToken(platform: GitPlatform, host?: string): Promise<string | null> {
    const integration = this.db.getGitIntegration(platform, host || null);
    if (!integration) {
      return null;
    }

    // Check if token is expired or expiring soon (within 5 minutes)
    if (integration.expires_at) {
      const expiresIn = integration.expires_at - Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (expiresIn < fiveMinutes) {
        this.logger.info(`Token for ${platform} expired or expiring soon, attempting refresh...`);
        
        // Try to refresh if we have a refresh token
        if (integration.refresh_token) {
          const refreshed = await this.refreshAccessToken(platform, host);
          if (refreshed) {
            // Get the refreshed token
            const updatedIntegration = this.db.getGitIntegration(platform, host || null);
            return updatedIntegration?.access_token || null;
          } else {
            this.logger.warn(`Failed to refresh token for ${platform}`);
            // Return expired token and let the caller handle 401
            return integration.access_token;
          }
        } else {
          this.logger.warn(`No refresh token available for ${platform}`);
          // Return expired token and let the caller handle 401
          return integration.access_token;
        }
      }
    }

    return integration.access_token;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(platform: GitPlatform, host?: string): Promise<boolean> {
    try {
      const integration = this.db.getGitIntegration(platform, host || null);
      
      if (!integration || !integration.refresh_token) {
        this.logger.failure(`No refresh token available for ${platform}`);
        return false;
      }

      // Only GitHub and GitLab support OAuth refresh
      if (platform !== 'github' && platform !== 'gitlab') {
        this.logger.warn(`Refresh not supported for ${platform}`);
        return false;
      }

      // Call cloud endpoint to refresh the token
      const providerParam = platform === 'github' ? 'github.com' : 'gitlab.com';
      const refreshUrl = `${CLOUD_OAUTH_ENDPOINT}/refresh?provider=${providerParam}&refresh_token=${encodeURIComponent(integration.refresh_token)}`;
      
      this.logger.debug(`Refreshing token via: ${CLOUD_OAUTH_ENDPOINT}/refresh`);
      
      const response = await fetch(refreshUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.failure(`Token refresh failed: ${response.status} ${errorText}`);
        
        // If refresh failed, delete the invalid token
        this.db.deleteGitIntegration(platform, host || null);
        return false;
      }

      const tokenData = await response.json();
      
      if (!tokenData.access_token) {
        this.logger.failure('No access token in refresh response');
        return false;
      }

      // Calculate expiration
      const expiresAt = tokenData.expires_in 
        ? Date.now() + tokenData.expires_in * 1000 
        : null;

      // Update token in database
      this.db.setGitIntegration(platform, {
        host: host || null,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || integration.refresh_token, // Use new or keep old
        token_type: tokenData.token_type || 'Bearer',
        expires_at: expiresAt,
      });

      this.logger.success(`Token refreshed successfully for ${platform}`);
      return true;
    } catch (error: any) {
      this.logger.failure(`Token refresh error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get access token for a platform (legacy method, kept for compatibility)
   * Note: Now automatically handles token refresh
   */
  async getAccessTokenLegacy(platform: GitPlatform, host?: string): Promise<string | null> {
    return this.getAccessToken(platform, host);
  }

  /**
   * Get authentication headers for a platform
   */
  async getAuthHeaders(platform: GitPlatform, host?: string): Promise<Record<string, string> | null> {
    const token = await this.getAccessToken(platform, host);
    if (!token) {
      return null;
    }

    // GitHub and GitHub Enterprise use "token" prefix
    if (platform === 'github' || platform === 'github-enterprise') {
      return {
        'Authorization': `token ${token}`,
      };
    }

    // GitLab uses "Bearer" prefix
    return {
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Disconnect an integration
   */
  disconnect(platform: GitPlatform, host?: string): void {
    this.db.deleteGitIntegration(platform, host || null);
    this.logger.info(`Disconnected ${platform}${host ? ` at ${host}` : ''}`);
  }

  /**
   * Get display name for a platform
   */
  private getPlatformDisplayName(platform: GitPlatform, host: string | null): string {
    switch (platform) {
      case 'github':
        return 'GitHub';
      case 'gitlab':
        return 'GitLab';
      case 'github-enterprise':
        return `GitHub Enterprise${host ? ` (${host})` : ''}`;
      case 'gitlab-self-managed':
        return `GitLab Self-Managed${host ? ` (${host})` : ''}`;
      default:
        return platform;
    }
  }

  /**
   * Generate a unique flow ID
   */
  private generateFlowId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Clean up expired pending flows
   */
  private cleanupExpiredFlows(): void {
    const cutoff = Date.now() - 15 * 60 * 1000; // 15 minutes
    const expiredFlows: string[] = [];
    
    for (const [flowId, flowData] of this.pendingFlows.entries()) {
      if (flowData.timestamp < cutoff) {
        this.pendingFlows.delete(flowId);
        expiredFlows.push(flowId);
      }
    }
    
    if (expiredFlows.length > 0) {
      this.logger.debug(`Cleaned up ${expiredFlows.length} expired OAuth flow(s)`);
    }
  }
}
