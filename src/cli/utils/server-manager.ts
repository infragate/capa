import { existsSync, readFileSync, unlinkSync } from 'fs';
import { getPidFilePath, loadSettings } from '../../shared/config';
import { stopAllWrapSessions } from './wrap/sessions';
import { isQuiet } from '../ui';

export interface ServerStatus {
  running: boolean;
  pid?: number;
  version?: string;
  port?: number;
  url?: string;
}

/**
 * Check if the capa server is running
 */
export async function getServerStatus(): Promise<ServerStatus> {
  const pidFile = getPidFilePath();
  
  if (!existsSync(pidFile)) {
    return { running: false };
  }
  
  try {
    const pidContent = readFileSync(pidFile, 'utf-8');
    const [pidStr, version] = pidContent.split(':');
    const pid = parseInt(pidStr, 10);
    
    // Check if process is actually running
    if (!isProcessRunning(pid)) {
      // Clean up stale PID file
      unlinkSync(pidFile);
      return { running: false };
    }
    
    // Try to ping the server
    const settings = await loadSettings();
    const url = `http://${settings.server.host}:${settings.server.port}`;
    
    try {
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          running: true,
          pid,
          version: data.version,
          port: settings.server.port,
          url,
        };
      }
    } catch (error) {
      // Server process exists but not responding
      console.warn('Server process exists but not responding');
    }
    
    return {
      running: true,
      pid,
      version,
      port: settings.server.port,
      url,
    };
  } catch (error) {
    return { running: false };
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error.code === 'EPERM'; // Process exists but we don't have permission
  }
}

export interface EnsureServerOptions {
  /** Suppress lifecycle messages on stdout; version mismatch still logs to stderr. */
  quiet?: boolean;
  /** When false, stop/restart only the server — not active capa wrap sessions. */
  stopWrapSessions?: boolean;
}

/**
 * Start the capa server
 */
export async function startServer(
  background: boolean = true,
  options?: { quiet?: boolean },
): Promise<void> {
  const quiet = options?.quiet ?? isQuiet();
  const status = await getServerStatus();

  if (status.running) {
    if (!quiet) {
      console.log(`Server already running (PID: ${status.pid})`);
    }
    return;
  }

  if (!quiet) {
    console.log('Starting capa server...');
  }
  // Get the path to the current executable
  const exePath = process.execPath;
  
  if (background) {
    // Start server as detached background process using the same executable
    const proc = Bun.spawn([exePath, '__server__'], {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
      detached: true,
    });
    
    proc.unref();
    
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const newStatus = await getServerStatus();
    if (newStatus.running) {
      if (!quiet) {
        console.log(`✓ Server started at ${newStatus.url}`);
      }
    } else {
      console.error('✗ Failed to start server');
      process.exit(1);
    }
  } else {
    // Run in foreground (for debugging)
    const proc = Bun.spawn([exePath, '__server__'], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });
    
    await proc.exited;
  }
}

/**
 * Stop the capa server and optionally any active `capa wrap` sessions.
 */
export async function stopServer(options?: {
  stopWrapSessions?: boolean;
}): Promise<void> {
  const stopWrapSessions = options?.stopWrapSessions !== false;
  const wrapCount = stopWrapSessions ? await stopAllWrapSessions() : 0;
  if (wrapCount > 0) {
    console.log(`✓ Stopped ${wrapCount} wrap session(s)`);
  }

  const status = await getServerStatus();

  if (!status.running || !status.pid) {
    if (wrapCount === 0) {
      console.log('Server is not running');
    }
    return;
  }

  console.log(`Stopping server (PID: ${status.pid})...`);

  try {
    process.kill(status.pid, 'SIGTERM');

    // Wait for process to exit
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!isProcessRunning(status.pid)) {
        break;
      }
    }

    // Force kill if still running
    if (isProcessRunning(status.pid)) {
      console.log('Force stopping server...');
      process.kill(status.pid, 'SIGKILL');
    }

    // Clean up PID file
    const pidFile = getPidFilePath();
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }

    console.log('✓ Server stopped');
  } catch (error) {
    console.error('Failed to stop server:', error);
    process.exit(1);
  }
}

/**
 * Restart the capa server
 */
export async function restartServer(options?: {
  stopWrapSessions?: boolean;
  quiet?: boolean;
}): Promise<void> {
  await stopServer(options);
  await new Promise(resolve => setTimeout(resolve, 500));
  await startServer(true, { quiet: options?.quiet ?? isQuiet() });
}

/**
 * Ensure server is running and version matches
 */
export async function ensureServer(
  currentVersion: string,
  options?: EnsureServerOptions,
): Promise<ServerStatus> {
  const quiet = options?.quiet ?? isQuiet();
  const stopWrapSessions = options?.stopWrapSessions ?? true;
  const status = await getServerStatus();

  if (!status.running) {
    await startServer(true, { quiet });
    return await getServerStatus();
  }

  // Check version match
  if (status.version && status.version !== currentVersion) {
    const message = `Server version mismatch (${status.version} vs ${currentVersion}), restarting...`;
    if (quiet) {
      console.error(message);
    } else {
      console.log(message);
    }
    await restartServer({ stopWrapSessions, quiet });
    return await getServerStatus();
  }

  return status;
}
