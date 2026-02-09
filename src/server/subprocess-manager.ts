import { spawn, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import type { CapaDatabase } from '../db/database';
import type { MCPServerDefinition } from '../types/capabilities';

export interface MCPSubprocessInfo {
  id: string;
  process: ChildProcess | null;
  port: number | null;
  url: string | null;
  status: 'starting' | 'running' | 'crashed' | 'stopped';
  restartCount?: number;
  lastRestartTime?: number;
}

export class SubprocessManager {
  private subprocesses = new Map<string, MCPSubprocessInfo>();
  private db: CapaDatabase;
  private readonly MAX_RESTART_ATTEMPTS = 3;
  private readonly RESTART_WINDOW_MS = 60000; // 1 minute
  private readonly BASE_RESTART_DELAY_MS = 1000;

  constructor(db: CapaDatabase) {
    this.db = db;
    this.loadExistingSubprocesses();
  }

  private loadExistingSubprocesses(): void {
    const all = this.db.getAllMCPSubprocesses();
    for (const sp of all) {
      // Check if process is still running
      if (sp.pid && this.isProcessRunning(sp.pid)) {
        this.subprocesses.set(sp.id, {
          id: sp.id,
          process: null, // We don't have the ChildProcess handle
          port: sp.port,
          url: sp.port ? `http://127.0.0.1:${sp.port}` : null,
          status: 'running',
        });
      } else {
        // Process is dead, clean up
        this.db.deleteMCPSubprocess(sp.id);
      }
    }
  }

  /**
   * Get or create a subprocess for an MCP server
   */
  async getOrCreateSubprocess(
    serverId: string,
    definition: MCPServerDefinition,
    projectPath: string
  ): Promise<MCPSubprocessInfo> {
    console.log(`            [SubprocessManager] Getting/creating subprocess for: ${serverId}`);
    
    // Generate hash of server configuration
    const configHash = this.hashConfig(definition);

    // Check if subprocess already exists
    const existing = this.db.getMCPSubprocessByHash(configHash);
    if (existing && existing.pid && this.isProcessRunning(existing.pid)) {
      console.log(`              Found existing subprocess (PID: ${existing.pid})`);
      let info = this.subprocesses.get(existing.id);
      if (!info) {
        info = {
          id: existing.id,
          process: null,
          port: existing.port,
          url: existing.port ? `http://127.0.0.1:${existing.port}` : null,
          status: 'running',
        };
        this.subprocesses.set(existing.id, info);
      }
      return info;
    }

    // Create new subprocess
    console.log(`              Creating new subprocess...`);
    return await this.createSubprocess(serverId, definition, configHash, projectPath);
  }

  private async createSubprocess(
    serverId: string,
    definition: MCPServerDefinition,
    configHash: string,
    projectPath: string
  ): Promise<MCPSubprocessInfo> {
    if (!definition.cmd) {
      throw new Error(`Server ${serverId} is remote and cannot be spawned as subprocess`);
    }

    console.log(`              Spawning subprocess: ${definition.cmd} ${(definition.args || []).join(' ')}`);

    const info: MCPSubprocessInfo = {
      id: serverId,
      process: null,
      port: null,
      url: null,
      status: 'starting',
      restartCount: 0,
      lastRestartTime: Date.now(),
    };

    this.subprocesses.set(serverId, info);

    // Parse command
    const args = definition.args || [];
    const env = { ...process.env, ...definition.env };

    console.log(`              Working directory: ${projectPath}`);

    // Spawn process from the project directory
    const proc = spawn(definition.cmd, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: projectPath,
    });

    info.process = proc;
    console.log(`              Subprocess started with PID: ${proc.pid}`);

    // Store in database
    this.db.upsertMCPSubprocess({
      id: serverId,
      config_hash: configHash,
      pid: proc.pid || null,
      port: null,
      status: 'running',
    });

    // Set up event handlers
    proc.on('error', (error) => {
      console.error(`              ✗ MCP subprocess ${serverId} error:`, error);
      info.status = 'crashed';
      this.db.upsertMCPSubprocess({
        id: serverId,
        config_hash: configHash,
        pid: null,
        port: null,
        status: 'crashed',
      });
    });

    proc.on('exit', (code, signal) => {
      console.log(`              MCP subprocess ${serverId} exited with code ${code}, signal ${signal}`);
      info.status = 'stopped';
      
      // Auto-restart on crash (not on clean exit)
      if (code !== 0 && code !== null) {
        // Initialize restart tracking if needed
        if (!info.restartCount) {
          info.restartCount = 0;
          info.lastRestartTime = Date.now();
        }

        // Reset restart count if outside the restart window
        const now = Date.now();
        if (info.lastRestartTime && (now - info.lastRestartTime) > this.RESTART_WINDOW_MS) {
          console.log(`              Restart window elapsed, resetting restart count`);
          info.restartCount = 0;
        }

        // Check if we've exceeded max restart attempts
        if (info.restartCount >= this.MAX_RESTART_ATTEMPTS) {
          console.error(`              ✗ Max restart attempts (${this.MAX_RESTART_ATTEMPTS}) reached for ${serverId}`);
          console.error(`              ✗ Subprocess will not be restarted. Please check configuration and try again.`);
          info.status = 'crashed';
          this.db.upsertMCPSubprocess({
            id: serverId,
            config_hash: configHash,
            pid: null,
            port: null,
            status: 'crashed',
          });
          return;
        }

        // Increment restart count and attempt restart with exponential backoff
        info.restartCount++;
        info.lastRestartTime = now;
        const delay = this.BASE_RESTART_DELAY_MS * Math.pow(2, info.restartCount - 1);
        
        console.log(`              Auto-restarting ${serverId} (attempt ${info.restartCount}/${this.MAX_RESTART_ATTEMPTS}) in ${delay}ms...`);
        setTimeout(() => {
          this.createSubprocess(serverId, definition, configHash, projectPath).catch((error) => {
            console.error(`              ✗ Failed to restart ${serverId}:`, error);
          });
        }, delay);
      } else {
        this.db.deleteMCPSubprocess(serverId);
        this.subprocesses.delete(serverId);
      }
    });

    // Capture stdout/stderr for logging
    proc.stdout?.on('data', (data) => {
      console.log(`              [${serverId} stdout] ${data.toString().trim()}`);
    });

    proc.stderr?.on('data', (data) => {
      console.error(`              [${serverId} stderr] ${data.toString().trim()}`);
    });

    // For stdio transport, the subprocess is ready immediately
    info.status = 'running';
    this.db.upsertMCPSubprocess({
      id: serverId,
      config_hash: configHash,
      pid: proc.pid || null,
      port: null,
      status: 'running',
    });

    console.log(`              ✓ Subprocess ready (status: ${info.status})`);
    return info;
  }

  /**
   * Stop a subprocess
   */
  stopSubprocess(serverId: string): void {
    const info = this.subprocesses.get(serverId);
    if (!info || !info.process) {
      return;
    }

    info.process.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
      if (info.process && !info.process.killed) {
        info.process.kill('SIGKILL');
      }
    }, 5000);

    this.subprocesses.delete(serverId);
    this.db.deleteMCPSubprocess(serverId);
  }

  /**
   * Reset a crashed subprocess (clears restart count, allowing manual retry)
   */
  resetSubprocess(serverId: string): void {
    const info = this.subprocesses.get(serverId);
    if (info) {
      info.restartCount = 0;
      info.lastRestartTime = Date.now();
      info.status = 'stopped';
      console.log(`            Reset subprocess ${serverId} - ready for manual restart`);
    }
  }

  /**
   * Stop all subprocesses
   */
  stopAll(): void {
    for (const [serverId] of this.subprocesses) {
      this.stopSubprocess(serverId);
    }
  }

  /**
   * Get subprocess info
   */
  getSubprocess(serverId: string): MCPSubprocessInfo | null {
    return this.subprocesses.get(serverId) || null;
  }

  private hashConfig(definition: MCPServerDefinition): string {
    const configStr = JSON.stringify(definition);
    return createHash('sha256').update(configStr).digest('hex');
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error.code === 'EPERM';
    }
  }
}
