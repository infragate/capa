import { spawn } from 'child_process';
import type { Tool, ToolFormatterDefinition, ToolMCPDefinition } from '../types/capabilities';
import { logger } from '../shared/logger';

const formatterLogger = logger.child('ToolFormatter');

export const CAPA_JSON_ARG = '_capa_json';

const DEFAULT_FORMATTER_TIMEOUT_MS = 3000;

/**
 * Strip the reserved `capa sh --json` meta-argument before forwarding tool args
 * to upstream servers. When present, the gateway skips the formatter.
 */
export function extractCapaShellMeta(args: Record<string, any>): {
  cleanArgs: Record<string, any>;
  skipFormatter: boolean;
} {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { cleanArgs: {}, skipFormatter: false };
  }
  if (!(CAPA_JSON_ARG in args)) {
    return { cleanArgs: { ...args }, skipFormatter: false };
  }
  const { [CAPA_JSON_ARG]: capaJson, ...cleanArgs } = args;
  const skipFormatter = capaJson === true || capaJson === 'true';
  return { cleanArgs, skipFormatter };
}

/**
 * Serialize a tool execution result into a text string suitable for an MCP content item.
 */
export function serializeToolResult(result: any): string {
  const items: any[] = result?.result;

  if (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every((i) => i !== null && typeof i === 'object' && 'type' in i && 'text' in i)
  ) {
    const processed = items.map((item) => {
      const raw = typeof item.text === 'string' ? item.text : JSON.stringify(item);
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });

    const value = processed.length === 1 ? processed[0] : processed;
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  if (result && typeof result === 'object' && 'success' in result) {
    if (result.success && typeof result.result === 'string') {
      return result.result;
    }
    if (!result.success && typeof result.error === 'string') {
      return result.error;
    }
  }

  return JSON.stringify(result);
}

/**
 * Pipe serialized tool output through an optional MCP formatter, returning the
 * final text for the MCP content item.
 */
export async function buildToolCallText(
  result: unknown,
  toolDef: Tool,
  options?: { skipFormatter?: boolean }
): Promise<string> {
  let text = serializeToolResult(result);

  if (options?.skipFormatter || toolDef.type !== 'mcp') {
    return text;
  }

  const formatter = (toolDef.def as ToolMCPDefinition).formatter;
  if (!formatter) {
    return text;
  }

  return applyToolFormatter(text, formatter);
}

/**
 * Run an operator-defined formatter command with the tool output on stdin.
 * On failure or timeout, returns the original input unchanged.
 */
export async function applyToolFormatter(
  input: string,
  formatter: ToolFormatterDefinition
): Promise<string> {
  const timeout = formatter.timeout ?? DEFAULT_FORMATTER_TIMEOUT_MS;
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellFlag = isWindows ? '/C' : '-c';

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const proc = spawn(shell, [shellFlag, formatter.cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      formatterLogger.warn(`Formatter timed out after ${timeout}ms, returning original output`);
      proc.kill();
      finish(input);
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      formatterLogger.warn(`Formatter failed to start: ${error.message}`);
      finish(input);
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        finish(stdout.replace(/\n$/, ''));
        return;
      }
      const detail = (stderr || stdout || `exit code ${code}`).trim();
      formatterLogger.warn(`Formatter exited with code ${code}: ${detail}`);
      finish(input);
    });

    // Formatters that exit before reading stdin (e.g. `exit 1`) can raise EPIPE
    // on write; swallow that so it does not become an unhandled rejection.
    proc.stdin?.on('error', (error) => {
      formatterLogger.warn(`Formatter stdin error: ${error.message}`);
      finish(input);
    });

    try {
      proc.stdin?.write(input);
      proc.stdin?.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      formatterLogger.warn(`Formatter stdin write failed: ${message}`);
      finish(input);
    }
  });
}
