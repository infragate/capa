// Token Refresh Scheduler
// Proactively monitors and refreshes OAuth2 tokens before they expire

import type { CapaDatabase } from '../db/database';
import type { OAuth2Manager } from './oauth-manager';
import type { GitIntegrationManager } from './git-integration-manager';
import { logger } from '../shared/logger';

export interface TokenRefreshSchedulerOptions {
  /**
   * How often to check for expiring tokens (in milliseconds)
   * Default: 60000 (1 minute)
   */
  checkInterval?: number;

  /**
   * Refresh tokens that expire within this threshold (in milliseconds)
   * Default: 600000 (10 minutes)
   */
  refreshThreshold?: number;
}

export class TokenRefreshScheduler {
  private db: CapaDatabase;
  private oauth2Manager: OAuth2Manager;
  private gitIntegrationManager?: GitIntegrationManager;
  private capabilitiesProvider?: () => Map<string, any>;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private logger = logger.child('TokenRefreshScheduler');
  
  private checkInterval: number;
  private refreshThreshold: number;

  constructor(
    db: CapaDatabase,
    oauth2Manager: OAuth2Manager,
    options: TokenRefreshSchedulerOptions = {}
  ) {
    this.db = db;
    this.oauth2Manager = oauth2Manager;
    this.checkInterval = options.checkInterval || 60000; // 1 minute
    this.refreshThreshold = options.refreshThreshold || 600000; // 10 minutes
  }

  /**
   * Set the Git Integration Manager (optional, for Git OAuth token refresh)
   */
  setGitIntegrationManager(manager: GitIntegrationManager): void {
    this.gitIntegrationManager = manager;
  }

  /**
   * Set the capabilities provider (same as OAuth2Manager)
   */
  setCapabilitiesProvider(provider: () => Map<string, any>): void {
    this.capabilitiesProvider = provider;
  }

  /**
   * Start the token refresh scheduler
   */
  start(): void {
    if (this.isRunning) {
      this.logger.info('Token refresh scheduler already running');
      return;
    }

    this.logger.info(`Starting token refresh scheduler (check every ${this.checkInterval / 1000}s, refresh threshold ${this.refreshThreshold / 1000}s)`);
    this.isRunning = true;

    // Run immediately on start
    this.checkAndRefreshTokens();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkAndRefreshTokens();
    }, this.checkInterval);
  }

  /**
   * Stop the token refresh scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping token refresh scheduler');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Check all tokens and refresh those about to expire
   */
  private async checkAndRefreshTokens(): Promise<void> {
    try {
      const now = Date.now();
      let checkedCount = 0;
      let refreshedCount = 0;
      let failedCount = 0;

      // Check MCP OAuth2 tokens
      if (this.capabilitiesProvider) {
        const capabilities = this.capabilitiesProvider();

        // Iterate through all projects
        for (const [projectId, projectCapabilities] of capabilities) {
          if (!projectCapabilities?.servers) {
            continue;
          }

          // Check each server in the project
          for (const server of projectCapabilities.servers) {
            const serverId = server.id;
            
            // Skip if not an OAuth2 server
            if (!server.def?.oauth2) {
              continue;
            }

            const oauth2Config = server.def.oauth2;

            // Get token data
            const tokenData = this.db.getOAuthToken(projectId, serverId);
            if (!tokenData) {
              // No token stored, skip
              continue;
            }

            checkedCount++;

            // Check if token has refresh_token
            if (!tokenData.refresh_token) {
              continue;
            }

            // Check if token has expiration
            if (!tokenData.expires_at) {
              continue;
            }

            // Calculate time until expiration
            const timeUntilExpiry = tokenData.expires_at - now;
            
            // If token expires within threshold, refresh it
            if (timeUntilExpiry < this.refreshThreshold) {
              const expiryMinutes = Math.floor(timeUntilExpiry / 60000);
              
              this.logger.info(`Refreshing MCP token for ${projectId}/${serverId} (expires in ${expiryMinutes} minutes)`);
              
              try {
                const success = await this.oauth2Manager.refreshAccessToken(
                  projectId,
                  serverId,
                  oauth2Config
                );

                if (success) {
                  refreshedCount++;
                  this.logger.success(`Successfully refreshed MCP token for ${projectId}/${serverId}`);
                } else {
                  failedCount++;
                  this.logger.failure(`Failed to refresh MCP token for ${projectId}/${serverId}`);
                }
              } catch (error: any) {
                failedCount++;
                this.logger.failure(`Error refreshing MCP token for ${projectId}/${serverId}: ${error.message}`);
              }
            }
          }
        }
      }

      // Check Git integration tokens
      if (this.gitIntegrationManager) {
        const gitIntegrations = this.db.getAllGitIntegrations();
        
        for (const integration of gitIntegrations) {
          // Only check GitHub and GitLab OAuth tokens (not PATs)
          if (integration.platform !== 'github' && integration.platform !== 'gitlab') {
            continue;
          }

          // Skip if no refresh token
          if (!integration.refresh_token) {
            continue;
          }

          // Skip if no expiration
          if (!integration.expires_at) {
            continue;
          }

          checkedCount++;

          // Calculate time until expiration
          const timeUntilExpiry = integration.expires_at - now;
          
          // If token expires within threshold, refresh it
          if (timeUntilExpiry < this.refreshThreshold) {
            const expiryMinutes = Math.floor(timeUntilExpiry / 60000);
            
            this.logger.info(`Refreshing Git integration token for ${integration.platform} (expires in ${expiryMinutes} minutes)`);
            
            try {
              const success = await this.gitIntegrationManager.refreshAccessToken(
                integration.platform,
                integration.host || undefined
              );

              if (success) {
                refreshedCount++;
                this.logger.success(`Successfully refreshed Git integration token for ${integration.platform}`);
              } else {
                failedCount++;
                this.logger.failure(`Failed to refresh Git integration token for ${integration.platform}`);
              }
            } catch (error: any) {
              failedCount++;
              this.logger.failure(`Error refreshing Git integration token for ${integration.platform}: ${error.message}`);
            }
          }
        }
      }

      // Only log summary if tokens were refreshed or failed
      if (refreshedCount > 0 || failedCount > 0) {
        this.logger.info(`Token refresh check: ${checkedCount} checked, ${refreshedCount} refreshed, ${failedCount} failed`);
      }
    } catch (error: any) {
      this.logger.error(`Error during token check: ${error.message}`);
    }
  }

  /**
   * Manually trigger a token refresh check (useful for testing)
   */
  async forceCheck(): Promise<void> {
    await this.checkAndRefreshTokens();
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    checkInterval: number;
    refreshThreshold: number;
  } {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      refreshThreshold: this.refreshThreshold,
    };
  }
}
