import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { ensureServer } from '../utils/server-manager';
import { VERSION } from '../../version';
import { getGitProviderByHost } from '../../shared/git-providers/registry';
import { header, footer, success, info, warn, error, runTasks } from '../ui';
import type { Task } from '../ui';

/**
 * Manual authentication command
 * Allows users to authenticate with Git providers preemptively
 */
export async function authCommand(provider?: string): Promise<void> {
  header('Git Authentication');

  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);

  let serverUrl = '';

  try {
    await runTasks([
      {
        title: 'Start CAPA server',
        task: async () => {
          const serverStatus = await ensureServer(VERSION);
          if (!serverStatus.running || !serverStatus.url) {
            throw new Error('Failed to start server');
          }
          serverUrl = serverStatus.url;
        },
      },
    ]);
  } catch {
    error('Failed to start server');
    db.close();
    process.exit(1);
  }

  if (!provider) {
    listConnectedProviders(db);
    info('Usage:');
    info('  capa auth <provider>  - Authenticate with a Git provider');
    info('Examples:');
    info('  capa auth github.com  - Authenticate with GitHub.com');
    info('  capa auth gitlab.com  - Authenticate with GitLab.com');
    info(
      'Note: For self-hosted instances (GitHub Enterprise, GitLab Self-Managed),',
    );
    info(`      use the web UI at: ${serverUrl}/ui/integrations`);
    db.close();
    return;
  }

  if (!isValidProvider(provider)) {
    error(`Invalid provider: ${provider}`);
    error('Provider must be a domain name (e.g., github.com, gitlab.com)');
    db.close();
    process.exit(1);
    return;
  }

  const existingToken = db.getGitOAuthToken(provider);
  if (existingToken) {
    let isExpired = false;
    if (existingToken.expires_at) {
      const expiresAt = new Date(existingToken.expires_at);
      const now = new Date();
      isExpired = expiresAt.getTime() <= now.getTime();
    }

    if (!isExpired) {
      success(`Already authenticated with ${provider}`);

      if (existingToken.expires_at) {
        const expiresAt = new Date(existingToken.expires_at);
        const now = new Date();
        const hoursUntilExpiry = Math.floor(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60),
        );
        info(`Token expires: ${expiresAt.toLocaleString()}`);
        info(`   (in approximately ${hoursUntilExpiry} hours)`);
        if (existingToken.refresh_token) {
          success('Refresh token available - will auto-refresh before expiration');
        }
      } else {
        success('Token has no expiration');
      }

      info('To re-authenticate, first disconnect from the provider:');
      info(`  Visit: ${serverUrl}/ui/integrations`);
      db.close();
      return;
    }

    warn('Existing token is expired, re-authenticating...');
  }

  info(`Authenticating with: ${provider}`);

  try {
    const gitProvider = getGitProviderByHost(provider);
    if (!gitProvider) {
      error(`Unknown git provider: ${provider}`);
      error('  For self-hosted instances, use the web UI at:');
      info(`  ${serverUrl}/ui/integrations`);
      db.close();
      process.exit(1);
      return;
    }
    const platform = gitProvider.id as 'github' | 'gitlab';

    await runTasks([
      {
        title: 'Initiate OAuth flow',
        task: async (ctx) => {
          const response = await fetch(
            `${serverUrl}/api/integrations/${platform}/oauth/start`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            },
          );

          if (!response.ok) {
            const body = await response.json();
            throw new Error(body.error || 'Failed to initiate authentication');
          }

          const { authorizationUrl } = await response.json();
          (ctx as { authorizationUrl?: string }).authorizationUrl = authorizationUrl;
        },
      },
      {
        title: 'Open browser for authentication',
        task: async (ctx) => {
          const authorizationUrl = (ctx as { authorizationUrl?: string }).authorizationUrl;
          if (!authorizationUrl) {
            throw new Error('Missing authorization URL');
          }

          const opened = await openBrowser(authorizationUrl);
          if (!opened) {
            warn('Please open this URL in your browser:');
            info(`   ${authorizationUrl}`);
          }
        },
      },
      {
        title: 'Waiting for browser authorization...',
        task: async () => {
          const completed = await pollForCompletion(db, provider, 300);
          if (!completed) {
            throw new Error('Authentication failed or timed out');
          }
        },
      },
    ]);

    success('Authentication successful!');

    const token = db.getGitOAuthToken(provider);
    if (token?.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const now = new Date();
      const hoursUntilExpiry = Math.floor(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60),
      );
      info(`Token expires: ${expiresAt.toLocaleString()}`);
      info(`   (in approximately ${hoursUntilExpiry} hours)`);
      if (token.refresh_token) {
        success('Refresh token stored - will auto-refresh before expiration');
      }
    }

    footer(`You can now access private repositories from ${provider}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Error: ${message}`);
    db.close();
    process.exit(1);
  }

  db.close();
}

function listConnectedProviders(db: CapaDatabase): void {
  info('Connected Git Providers:');

  const tokens = db.getAllGitOAuthTokens();
  if (tokens.length === 0) {
    info('  No providers connected yet.');
    return;
  }

  for (const token of tokens) {
    const providerEmoji = getGitProviderByHost(token.provider)?.emoji ?? '🔗';
    info(`  ${providerEmoji} ${token.provider}`);

    if (token.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const now = new Date();
      const hoursUntilExpiry = Math.floor(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60),
      );

      if (hoursUntilExpiry < 0) {
        warn(`    Expired: ${expiresAt.toLocaleString()}`);
      } else if (hoursUntilExpiry < 1) {
        const minutesUntilExpiry = Math.floor(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60),
        );
        info(
          `    Expires soon: ${expiresAt.toLocaleString()} (in ${minutesUntilExpiry} minutes)`,
        );
      } else {
        info(
          `    Expires: ${expiresAt.toLocaleString()} (in ~${hoursUntilExpiry} hours)`,
        );
      }

      if (token.refresh_token) {
        success('    Auto-refresh enabled');
      } else {
        warn('    No refresh token (will need manual re-auth after expiration)');
      }
    } else {
      success('    No expiration');
    }
  }
}

function isValidProvider(provider: string): boolean {
  return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(provider);
}

async function pollForCompletion(
  db: CapaDatabase,
  provider: string,
  timeoutSeconds: number,
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    const token = db.getGitOAuthToken(provider);
    if (token) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

async function openBrowser(url: string): Promise<boolean> {
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
  } catch {
    return false;
  }
}
