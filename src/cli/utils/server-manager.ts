import { existsSync, readFileSync, unlinkSync } from 'fs';
import { getPidFilePath, loadSettings } from '../../shared/config';

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

/**
 * Start the capa server
 */
export async function startServer(background: boolean = true): Promise<void> {
  const status = await getServerStatus();
  
  if (status.running) {
    console.log(`Server already running (PID: ${status.pid})`);
    return;
  }
  
  console.log('Starting capa server...');
  
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
      console.log(`✓ Server started at ${newStatus.url}`);
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
 * Stop the capa server
 */
export async function stopServer(): Promise<void> {
  const status = await getServerStatus();
  
  if (!status.running || !status.pid) {
    console.log('Server is not running');
    return;
  }
  
  console.log(`Stopping server (PID: ${status.pid})...`);
  
  try {
    process.kill(status.pid, 'SIGTERM');
    
    // Wait for process to exit
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
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
export async function restartServer(): Promise<void> {
  await stopServer();
  await new Promise(resolve => setTimeout(resolve, 500));
  await startServer();
}

/**
 * Ensure server is running and version matches
 */
export async function ensureServer(currentVersion: string): Promise<ServerStatus> {
  const status = await getServerStatus();
  
  if (!status.running) {
    await startServer();
    return await getServerStatus();
  }
  
  // Check version match
  if (status.version && status.version !== currentVersion) {
    console.log(`Server version mismatch (${status.version} vs ${currentVersion}), restarting...`);
    await restartServer();
    return await getServerStatus();
  }
  
  return status;
}
