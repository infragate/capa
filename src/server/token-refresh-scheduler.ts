// Token Refresh Scheduler
// Proactively monitors and refreshes OAuth2 tokens before they expire

import type { CapaDatabase } from '../db/database';
import type { OAuth2Manager } from './oauth-manager';
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

  /**
   * Enable debug logging
   * Default: false
   */
  debug?: boolean;
}

export class TokenRefreshScheduler {
  private db: CapaDatabase;
  private oauth2Manager: OAuth2Manager;
  private capabilitiesProvider?: () => Map<string, any>;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private logger = logger.child('TokenRefreshScheduler');
  
  private checkInterval: number;
  private refreshThreshold: number;
  private debug: boolean;

  constructor(
    db: CapaDatabase,
    oauth2Manager: OAuth2Manager,
    options: TokenRefreshSchedulerOptions = {}
  ) {
    this.db = db;
    this.oauth2Manager = oauth2Manager;
    this.checkInterval = options.checkInterval || 60000; // 1 minute
    this.refreshThreshold = options.refreshThreshold || 600000; // 10 minutes
    this.debug = options.debug || false;
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
      this.log('Token refresh scheduler already running');
      return;
    }

    this.log(`Starting token refresh scheduler (check every ${this.checkInterval / 1000}s, refresh threshold ${this.refreshThreshold / 1000}s)`);
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

    this.log('Stopping token refresh scheduler');
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
      if (!this.capabilitiesProvider) {
        this.log('No capabilities provider set, skipping token check');
        return;
      }

      const capabilities = this.capabilitiesProvider();
      const now = Date.now();
      let checkedCount = 0;
      let refreshedCount = 0;
      let failedCount = 0;

      this.log('Checking tokens for expiration...');

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
            this.log(`  ⚠ Token for ${projectId}/${serverId} has no refresh_token, skipping`);
            continue;
          }

          // Check if token has expiration
          if (!tokenData.expires_at) {
            this.log(`  ℹ Token for ${projectId}/${serverId} has no expiration, skipping`);
            continue;
          }

          // Calculate time until expiration
          const timeUntilExpiry = tokenData.expires_at - now;
          
          // If token expires within threshold, refresh it
          if (timeUntilExpiry < this.refreshThreshold) {
            const expiryMinutes = Math.floor(timeUntilExpiry / 60000);
            const thresholdMinutes = Math.floor(this.refreshThreshold / 60000);
            
            this.log(`  🔄 Token for ${projectId}/${serverId} expires in ${expiryMinutes}m (threshold: ${thresholdMinutes}m), refreshing...`);
            
            try {
              const success = await this.oauth2Manager.refreshAccessToken(
                projectId,
                serverId,
                oauth2Config
              );

              if (success) {
                refreshedCount++;
                this.log(`    ✓ Successfully refreshed token for ${projectId}/${serverId}`);
              } else {
                failedCount++;
                this.log(`    ✗ Failed to refresh token for ${projectId}/${serverId}`);
              }
            } catch (error: any) {
              failedCount++;
              this.log(`    ✗ Error refreshing token for ${projectId}/${serverId}: ${error.message}`);
            }
          } else {
            const expiryMinutes = Math.floor(timeUntilExpiry / 60000);
            this.log(`  ✓ Token for ${projectId}/${serverId} valid for ${expiryMinutes}m`);
          }
        }
      }

      if (checkedCount === 0) {
        this.log('No OAuth2 tokens to check');
      } else {
        this.log(`Token check complete: ${checkedCount} checked, ${refreshedCount} refreshed, ${failedCount} failed`);
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

  /**
   * Log message (only if debug is enabled)
   */
  private log(message: string): void {
    if (this.debug) {
      this.logger.debug(message);
    }
  }
}
