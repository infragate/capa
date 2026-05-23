import type { Database } from 'bun:sqlite';
import type { GitIntegration } from '../types/database';
import { getGitProvider, getGitProviderByHost } from '../shared/git-providers/registry';

export class GitIntegrationsRepo {
  constructor(private db: Database) {}

  get(platform: string, host: string | null = null): GitIntegration | null {
    return this.db.query(
      'SELECT * FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))'
    ).get(platform, host, host) as GitIntegration | null;
  }

  set(
    platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed',
    tokenData: {
      host?: string | null;
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    const now = Date.now();
    const host = tokenData.host || null;

    // Check if an entry already exists
    const existing = this.get(platform, host);

    if (existing) {
      // Update existing entry
      this.db.run(
        `UPDATE git_integrations SET
          access_token = ?,
          refresh_token = ?,
          token_type = ?,
          expires_at = ?,
          updated_at = ?
         WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))`,
        [
          tokenData.access_token,
          tokenData.refresh_token || null,
          tokenData.token_type || 'Bearer',
          tokenData.expires_at || null,
          now,
          platform,
          host,
          host
        ]
      );
    } else {
      // Insert new entry
      this.db.run(
        `INSERT INTO git_integrations (platform, host, access_token, refresh_token, token_type, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          platform,
          host,
          tokenData.access_token,
          tokenData.refresh_token || null,
          tokenData.token_type || 'Bearer',
          tokenData.expires_at || null,
          now,
          now
        ]
      );
    }
  }

  delete(platform: string, host: string | null = null): void {
    this.db.run(
      'DELETE FROM git_integrations WHERE platform = ? AND (host = ? OR (host IS NULL AND ? IS NULL))',
      [platform, host, host]
    );
  }

  getAll(): GitIntegration[] {
    return this.db.query('SELECT * FROM git_integrations ORDER BY created_at DESC').all() as GitIntegration[];
  }

  getOAuthToken(provider: string): GitIntegration | null {
    const platform = getGitProviderByHost(provider)?.id as 'github' | 'gitlab' | undefined;
    if (!platform) {
      return null;
    }

    return this.get(platform, null);
  }

  setOAuthToken(
    provider: string,
    tokenData: {
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    const platform = getGitProviderByHost(provider)?.id as 'github' | 'gitlab' | undefined;
    if (!platform) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    this.set(platform, tokenData);
  }

  getAllOAuthTokens(): Array<GitIntegration & { provider: string }> {
    const integrations = this.getAll();

    return integrations
      .filter(i => getGitProvider(i.platform))
      .map(integration => ({
        ...integration,
        provider: getGitProvider(integration.platform)!.host,
      }));
  }
}
