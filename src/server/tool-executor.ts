import { spawn } from 'child_process';
import { resolve } from 'path';
import type { CapaDatabase } from '../db/database';
import type { ToolCommandDefinition, CommandSpec } from '../types/capabilities';
import { resolveVariablesInObject } from '../shared/variable-resolver';

export interface CommandExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

export class CommandToolExecutor {
  private db: CapaDatabase;
  private projectId: string;
  private projectPath: string;

  constructor(db: CapaDatabase, projectId: string, projectPath: string) {
    this.db = db;
    this.projectId = projectId;
    this.projectPath = projectPath;
  }

  /**
   * Execute a command-type tool
   */
  async execute(
    toolId: string,
    definition: ToolCommandDefinition,
    args: Record<string, any>
  ): Promise<CommandExecutionResult> {
    // Check if tool needs initialization
    const initState = this.db.getToolInitState(this.projectId, toolId);
    
    if (definition.init && (!initState || !initState.initialized)) {
      console.log(`Initializing tool ${toolId}...`);
      const initResult = await this.runCommand(definition.init, {});
      
      if (!initResult.success) {
        // Store error
        this.db.setToolInitialized(this.projectId, toolId, initResult.error || 'Init failed');
        return {
          success: false,
          error: `Tool initialization failed: ${initResult.error}`,
        };
      }
      
      // Mark as initialized
      this.db.setToolInitialized(this.projectId, toolId, null);
    } else if (initState && initState.last_error) {
      // Tool initialization previously failed
      return {
        success: false,
        error: `Tool initialization previously failed: ${initState.last_error}`,
      };
    }

    // Run the actual command
    return await this.runCommand(definition.run, args);
  }

  private async runCommand(
    spec: CommandSpec,
    args: Record<string, any>
  ): Promise<CommandExecutionResult> {
    // Resolve variables in the command spec
    const resolvedSpec = resolveVariablesInObject(spec, this.projectId, this.db);
    
    // Build command with arguments
    let cmd = resolvedSpec.cmd;
    
    // Replace argument placeholders
    if (spec.args) {
      for (const argDef of spec.args) {
        const value = args[argDef.name];
        if (value === undefined && argDef.required !== false) {
          return {
            success: false,
            error: `Missing required argument: ${argDef.name}`,
          };
        }
        
        // Simple placeholder replacement - in production would need more sophisticated handling
        const placeholder = `{${argDef.name}}`;
        if (cmd.includes(placeholder)) {
          cmd = cmd.replace(placeholder, String(value));
        }
      }
    }

    // Determine working directory
    const cwd = spec.dir ? resolve(this.projectPath, spec.dir) : this.projectPath;

    // Execute command
    return new Promise((resolve) => {
      const proc = spawn(cmd, {
        cwd,
        env: { ...process.env, ...spec.env },
        shell: true,
        timeout: 60000, // 60 second timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            result: stdout || stderr,
          });
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Command exited with code ${code}`,
          });
        }
      });
    });
  }
}
