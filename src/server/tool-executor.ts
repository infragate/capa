import { spawn } from 'child_process';
import { resolve } from 'path';
import type { CapaDatabase } from '../db/database';
import type { ToolCommandDefinition, CommandSpec } from '../types/capabilities';
import { resolveVariablesInObject } from '../shared/variable-resolver';
import { logger } from '../shared/logger';

export interface CommandExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * POSIX-style tokenizer for the operator's `cmd` template. Honors single and
 * double quotes and backslash escapes so operators can group multi-word
 * defaults (e.g. `git commit -m "default message"`). The result is a fixed
 * argv shape that is decided BEFORE any caller-supplied value is substituted,
 * which is what prevents caller values from spawning new argv elements or
 * shell metacharacters.
 */
export function tokenizeCommandTemplate(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;

  const flush = () => {
    if (hasToken) {
      tokens.push(current);
      current = '';
      hasToken = false;
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < input.length) {
        const next = input[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next;
          i++;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
    } else if (ch === '"') {
      inDouble = true;
      hasToken = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i++;
      hasToken = true;
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
    } else {
      current += ch;
      hasToken = true;
    }
  }

  if (inSingle || inDouble) {
    throw new Error('Unterminated quote in command template');
  }
  flush();
  return tokens;
}

function substitutePlaceholders(token: string, values: Record<string, string>): string {
  return token.replace(PLACEHOLDER_RE, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
}

export class CommandToolExecutor {
  private db: CapaDatabase;
  private projectId: string;
  private projectPath: string;
  private logger = logger.child('CommandExecutor');

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
    this.logger.info(`Executing tool: ${toolId}`);
    this.logger.debug(`Args: ${JSON.stringify(args)}`);

    // Check if tool needs initialization
    const initState = this.db.getToolInitState(this.projectId, toolId);

    if (definition.init && (!initState || !initState.initialized)) {
      this.logger.info(`Initializing tool ${toolId}...`);
      const initResult = await this.runCommand(definition.init, {});

      if (!initResult.success) {
        this.logger.failure(`Init failed: ${initResult.error}`);
        // Store error
        this.db.setToolInitialized(this.projectId, toolId, initResult.error || 'Init failed');
        return {
          success: false,
          error: `Tool initialization failed: ${initResult.error}`,
        };
      }

      this.logger.success('Tool initialized');
      this.db.setToolInitialized(this.projectId, toolId, null);
    } else if (initState && initState.last_error) {
      this.logger.failure(`Tool initialization previously failed: ${initState.last_error}`);
      return {
        success: false,
        error: `Tool initialization previously failed: ${initState.last_error}`,
      };
    }

    // Run the actual command
    const result = await this.runCommand(definition.run, args);
    if (result.success) {
      this.logger.success('Command succeeded');
    } else {
      this.logger.failure(`Command failed: ${result.error}`);
    }
    return result;
  }

  private async runCommand(
    spec: CommandSpec,
    args: Record<string, any>
  ): Promise<CommandExecutionResult> {
    // Resolve variables in the command spec
    const resolvedSpec = resolveVariablesInObject(spec, this.projectId, this.db);

    // Tokenize the OPERATOR template first. The argv shape is fixed here,
    // before any caller-supplied value is touched — caller values are
    // substituted into existing tokens, never able to create new ones.
    let templateTokens: string[];
    try {
      templateTokens = tokenizeCommandTemplate(resolvedSpec.cmd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Invalid command template: ${message}` };
    }
    if (templateTokens.length === 0) {
      return { success: false, error: 'Command template is empty' };
    }

    // Collect substitution values: caller-supplied first, falling back to
    // declared defaults; reject calls that omit a required value.
    const values: Record<string, string> = {};
    if (spec.args) {
      for (const argDef of spec.args) {
        let value = args[argDef.name];
        if (value === undefined && argDef.default !== undefined) {
          value = argDef.default;
        }
        if (value === undefined && argDef.required !== false) {
          return {
            success: false,
            error: `Missing required argument: ${argDef.name}`,
          };
        }
        if (value !== undefined) {
          values[argDef.name] = String(value);
        }
      }
    }

    const substituted = templateTokens.map((t) => substitutePlaceholders(t, values));
    const [program, ...programArgs] = substituted;

    // Determine working directory
    const cwd = spec.dir ? resolve(this.projectPath, spec.dir) : this.projectPath;

    this.logger.info(`          Running command: ${program} ${programArgs.join(' ')}`);
    this.logger.info(`          Working directory: ${cwd}`);

    // Execute command. shell:false is the security guarantee — values become
    // argv elements, never re-parsed by a shell, so metacharacters in values
    // are inert.
    const env = { ...process.env, ...spec.env };

    return new Promise((resolve) => {
      const proc = spawn(program, programArgs, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        timeout: 60000,
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
        this.logger.error(`          Process error: ${error.message}`);
        resolve({
          success: false,
          error: error.message,
        });
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          const output = (stdout || stderr).replace(/\n$/, '');
          this.logger.info(`          Exit code: 0`);
          if (output) {
            this.logger.info(`          Output: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`);
          }
          resolve({
            success: true,
            result: output,
          });
        } else {
          const error = (stderr || stdout || `Command exited with code ${code}`).replace(/\n$/, '');
          this.logger.error(`          Exit code: ${code}`);
          this.logger.error(`          Error: ${error.substring(0, 200)}${error.length > 200 ? '...' : ''}`);
          resolve({
            success: false,
            error: error,
          });
        }
      });
    });
  }
}
