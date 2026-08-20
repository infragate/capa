import { peekSecretStorageTier } from '../../shared/secret-crypto';
import { getServerStatus } from '../utils/server-manager';

export async function statusCommand(): Promise<void> {
  console.log('Checking capa server status...\n');

  const status = await getServerStatus();
  const localTier = peekSecretStorageTier();

  if (!status.running) {
    console.log('Status: ✗ Not running');
    console.log(`Secret storage: ${formatSecretTier(localTier)}`);
    console.log('\nUse "capa start" to start the server');
    return;
  }

  console.log('Status: ✓ Running');

  if (status.pid) {
    console.log(`PID: ${status.pid}`);
  }

  if (status.version) {
    console.log(`Version: ${status.version}`);
  }

  if (status.port) {
    console.log(`Port: ${status.port}`);
  }

  if (status.url) {
    console.log(`URL: ${status.url}`);

    try {
      const response = await fetch(`${status.url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          uptime?: number;
          secretStorage?: { tier?: string };
        };
        console.log('Health: ✓ Healthy');

        if (data.uptime) {
          console.log(`Uptime: ${formatUptime(data.uptime)}`);
        }

        const tier = data.secretStorage?.tier ?? localTier;
        console.log(`Secret storage: ${formatSecretTier(tier)}`);
      } else {
        console.log('Health: ⚠ Responding but unhealthy');
        console.log(`Secret storage: ${formatSecretTier(localTier)}`);
      }
    } catch {
      console.log('Health: ⚠ Not responding (process exists but server may be starting or stuck)');
      console.log(`Secret storage: ${formatSecretTier(localTier)}`);
    }
  } else {
    console.log(`Secret storage: ${formatSecretTier(localTier)}`);
  }
}

function formatSecretTier(tier: string): string {
  if (tier === 'file') return 'file (fallback)';
  return tier;
}

/**
 * Format uptime in seconds to human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}
