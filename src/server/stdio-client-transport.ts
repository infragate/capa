import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { IOType } from 'node:child_process';
import type { Stream } from 'node:stream';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export type HiddenStdioServerParameters = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  stderr?: IOType | Stream | number;
  cwd?: string;
};

/**
 * Stdio MCP client transport identical to the SDK's {@link StdioClientTransport}
 * except it always passes `windowsHide: true` so stdio MCP servers do not flash
 * a cmd.exe window on Windows (capa runs outside Electron).
 */
export class HiddenStdioClientTransport implements Transport {
  private _process?: ChildProcess;
  private _readBuffer = new ReadBuffer();
  private _serverParams: HiddenStdioServerParameters;
  private _stderrStream: PassThrough | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(server: HiddenStdioServerParameters) {
    this._serverParams = server;
    if (server.stderr === 'pipe' || server.stderr === 'overlapped') {
      this._stderrStream = new PassThrough();
    }
  }

  async start(): Promise<void> {
    if (this._process) {
      throw new Error(
        'HiddenStdioClientTransport already started! If using Client class, note that connect() calls start() automatically.'
      );
    }

    return new Promise((resolve, reject) => {
      this._process = spawn(this._serverParams.command, this._serverParams.args ?? [], {
        env: {
          ...getDefaultEnvironment(),
          ...this._serverParams.env,
        },
        stdio: ['pipe', 'pipe', this._serverParams.stderr ?? 'inherit'],
        shell: false,
        windowsHide: true,
        cwd: this._serverParams.cwd,
      });

      this._process.on('error', (error: Error) => {
        reject(error);
        this.onerror?.(error);
      });

      this._process.on('spawn', () => {
        resolve();
      });

      this._process.on('close', () => {
        this._process = undefined;
        this.onclose?.();
      });

      this._process.stdin?.on('error', (error: Error) => {
        this.onerror?.(error);
      });

      this._process.stdout?.on('data', (chunk: Buffer) => {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      });

      this._process.stdout?.on('error', (error: Error) => {
        this.onerror?.(error);
      });

      if (this._stderrStream && this._process.stderr) {
        this._process.stderr.pipe(this._stderrStream);
      }
    });
  }

  get stderr(): Stream | null {
    if (this._stderrStream) {
      return this._stderrStream;
    }
    return this._process?.stderr ?? null;
  }

  get pid(): number | null {
    return this._process?.pid ?? null;
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    if (this._process) {
      const processToClose = this._process;
      this._process = undefined;
      const closePromise = new Promise<void>((resolve) => {
        processToClose.once('close', () => {
          resolve();
        });
      });
      try {
        processToClose.stdin?.end();
      } catch {
        // ignore
      }
      await Promise.race([
        closePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
      ]);
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGTERM');
        } catch {
          // ignore
        }
        await Promise.race([
          closePromise,
          new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
        ]);
      }
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    this._readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this._process?.stdin) {
        throw new Error('Not connected');
      }
      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve();
      } else {
        this._process.stdin.once('drain', resolve);
      }
    });
  }
}
