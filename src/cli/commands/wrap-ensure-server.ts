import { ensureServer } from '../utils/server-manager';
import { VERSION } from '../../version';

/**
 * Ensure the capa server is up before launching a wrap session.
 * Warm wrap skips install (which would otherwise start the server).
 */
export async function ensureWrapServerRunning(): Promise<void> {
  const serverStatus = await ensureServer(VERSION);
  if (!serverStatus.running || !serverStatus.url) {
    throw new Error('Failed to start server');
  }
}
