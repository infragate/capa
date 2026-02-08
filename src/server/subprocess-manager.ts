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
}

export class SubprocessManager {
  private subprocesses = new Map<string, MCPSubprocessInfo>();
  private db: CapaDatabase;

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
    definition: MCPServerDefinition
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
    return await this.createSubprocess(serverId, definition, configHash);
  }

  private async createSubprocess(
    serverId: string,
    definition: MCPServerDefinition,
    configHash: string
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
    };

    this.subprocesses.set(serverId, info);

    // Parse command
    const args = definition.args || [];
    const env = { ...process.env, ...definition.env };

    // Spawn process
    const proc = spawn(definition.cmd, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    info.process = proc;
    console.log(`              Subprocess started with PID: ${proc.pid}`);

    // Store in database
    this.db.upsertMCPSubprocess({
      id: serverId,
      config_hash: configHash,
      pid: proc.pid || null,
      port: null,
      status: 'starting',
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
        console.log(`              Auto-restarting ${serverId}...`);
        setTimeout(() => {
          this.createSubprocess(serverId, definition, configHash);
        }, 1000);
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
