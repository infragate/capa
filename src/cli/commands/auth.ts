import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { ensureServer } from '../utils/server-manager';
import { VERSION } from '../../version';

/**
 * Manual authentication command
 * Allows users to authenticate with Git providers preemptively
 */
export async function authCommand(provider?: string): Promise<void> {
  console.log('🔐 Git Authentication\n');

  // Load settings and database
  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);

  // Ensure server is running
  console.log('🚀 Starting CAPA server...');
  const serverStatus = await ensureServer(VERSION);

  if (!serverStatus.running || !serverStatus.url) {
    console.error('✗ Failed to start server');
    db.close();
    process.exit(1);
  }

  console.log(`✓ Server running at ${serverStatus.url}\n`);

  // If no provider specified, show connected providers
  if (!provider) {
    console.log('Connected Git Providers:');
    console.log('─'.repeat(50));
    
    const tokens = db.getAllGitOAuthTokens();
    if (tokens.length === 0) {
      console.log('  No providers connected yet.\n');
    } else {
      for (const token of tokens) {
        const providerEmoji = token.provider === 'github.com' ? '🐙' : '🦊';
        console.log(`  ${providerEmoji} ${token.provider}`);
        
        if (token.expires_at) {
          const expiresAt = new Date(token.expires_at);
          const now = new Date();
          const hoursUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60));
          
          if (hoursUntilExpiry < 0) {
            console.log(`    ⚠️  Expired: ${expiresAt.toLocaleString()}`);
          } else if (hoursUntilExpiry < 1) {
            const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60));
            console.log(`    ⏰ Expires soon: ${expiresAt.toLocaleString()} (in ${minutesUntilExpiry} minutes)`);
          } else {
            console.log(`    📅 Expires: ${expiresAt.toLocaleString()} (in ~${hoursUntilExpiry} hours)`);
          }
          
          if (token.refresh_token) {
            console.log(`    ✓ Auto-refresh enabled`);
          } else {
            console.log(`    ⚠️  No refresh token (will need manual re-auth after expiration)`);
          }
        } else {
          console.log(`    ✓ No expiration`);
        }
        
        console.log('');
      }
    }

    console.log('Usage:');
    console.log('  capa auth <provider>  - Authenticate with a Git provider');
    console.log('\nExamples:');
    console.log('  capa auth github.com  - Authenticate with GitHub.com');
    console.log('  capa auth gitlab.com  - Authenticate with GitLab.com');
    console.log('\nNote: For self-hosted instances (GitHub Enterprise, GitLab Self-Managed),');
    console.log(`      use the web UI at: ${serverStatus.url}/ui/integrations`);
    
    db.close();
    return;
  }

  // Validate provider format
  if (!isValidProvider(provider)) {
    console.error(`✗ Invalid provider: ${provider}`);
    console.error('\nProvider must be a domain name (e.g., github.com, gitlab.com)');
    db.close();
    process.exit(1);
  }

  console.log(`Authenticating with: ${provider}\n`);

  try {
    // Determine platform from provider
    let platform: 'github' | 'gitlab';
    if (provider === 'github.com') {
      platform = 'github';
    } else if (provider === 'gitlab.com') {
      platform = 'gitlab';
    } else {
      console.error(`✗ Only github.com and gitlab.com are currently supported`);
      console.error('  For self-hosted instances, use the web UI at:');
      console.log(`  ${serverStatus.url}/ui/integrations`);
      db.close();
      process.exit(1);
    }

    // Initiate OAuth flow
    const response = await fetch(`${serverStatus.url}/api/integrations/${platform}/oauth/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to initiate authentication');
    }

    const { authorizationUrl, flowId } = await response.json();

    // Open browser
    console.log('🌐 Opening browser for authentication...');
    const opened = await openBrowser(authorizationUrl);
    
    if (!opened) {
      console.log('\n⚠️  Please open this URL in your browser:');
      console.log(`   ${authorizationUrl}`);
    }

    // Poll for completion
    console.log('⏳ Waiting for authorization...\n');
    const success = await pollForCompletion(db, provider, 300); // 5 minute timeout

    if (success) {
      console.log('✓ Authentication successful!');
      
      // Show token info
      const token = db.getGitOAuthToken(provider);
      if (token && token.expires_at) {
        const expiresAt = new Date(token.expires_at);
        const now = new Date();
        const hoursUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60));
        
        console.log(`\n📅 Token expires: ${expiresAt.toLocaleString()}`);
        console.log(`   (in approximately ${hoursUntilExpiry} hours)`);
        
        if (token.refresh_token) {
          console.log(`✓ Refresh token stored - will auto-refresh before expiration`);
        }
      }
      
      console.log(`\nYou can now access private repositories from ${provider}`);
    } else {
      console.error('✗ Authentication failed or timed out');
      db.close();
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`✗ Error: ${error.message}`);
    db.close();
    process.exit(1);
  }

  db.close();
}

/**
 * Validate provider format
 */
function isValidProvider(provider: string): boolean {
  // Basic domain validation
  return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(provider);
}

/**
 * Poll database for OAuth completion
 */
async function pollForCompletion(db: CapaDatabase, provider: string, timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    // Check if token exists in database
    const token = db.getGitOAuthToken(provider);
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
  } catch (error) {
    return false;
  }
}
