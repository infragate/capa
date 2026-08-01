import type { IOType } from "node:child_process";
import { type ChildProcess, spawn } from "node:child_process";
import type { Stream } from "node:stream";
import { PassThrough } from "node:stream";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	ReadBuffer,
	serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type HiddenStdioServerParameters = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	stderr?: IOType | Stream | number;
	cwd?: string;
};

/** Matches common fatal child-runtime output (Rust panic, abort, Node OOM, …). */
const FATAL_STDERR_RE =
	/panicked at|fatal runtime error|Fatal error:|FATAL ERROR|Aborted \(core dumped\)/i;

/**
 * Stdio MCP client transport identical to the SDK's {@link StdioClientTransport}
 * except it always passes `windowsHide: true` so stdio MCP servers do not flash
 * a cmd.exe window on Windows (capa runs outside Electron).
 *
 * Fail-fast behaviors beyond the upstream transport:
 * - Listen for process `exit` (not only `close`) so dead children reject
 *   in-flight requests even when stdio pipes linger.
 * - Pipe + tee stderr by default and kill the child when fatal runtime output
 *   (e.g. a Rust panic in a Tokio worker) appears without process exit — the
 *   common owl-mcp / pretty_rdf hang mode.
 */
export class HiddenStdioClientTransport implements Transport {
	private _process?: ChildProcess;
	private _readBuffer = new ReadBuffer();
	private _serverParams: HiddenStdioServerParameters;
	private _stderrStream: PassThrough | null = null;
	private _ended = false;
	private _intentionalClose = false;
	private _exitCode: number | null = null;
	private _exitSignal: NodeJS.Signals | null = null;
	private _crashReason: string | null = null;
	private _stderrTail = "";
	private _killingForCrash = false;

	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

	constructor(server: HiddenStdioServerParameters) {
		this._serverParams = server;
		// Always expose a PassThrough so callers (and our panic watcher) can
		// observe stderr. When the child uses pipe/overlapped we tee into it;
		// inherit is upgraded to pipe+tee so we can detect fatal output.
		this._stderrStream = new PassThrough();
	}

	/** Exit code from the last child process, if it has exited. */
	get exitCode(): number | null {
		return this._exitCode;
	}

	/** Exit signal from the last child process, if it was killed by a signal. */
	get exitSignal(): NodeJS.Signals | null {
		return this._exitSignal;
	}

	/** Reason recorded when the child was killed after fatal stderr output. */
	get crashReason(): string | null {
		return this._crashReason;
	}

	async start(): Promise<void> {
		if (this._process) {
			throw new Error(
				"HiddenStdioClientTransport already started! If using Client class, note that connect() calls start() automatically.",
			);
		}

		this._ended = false;
		this._intentionalClose = false;
		this._exitCode = null;
		this._exitSignal = null;
		this._crashReason = null;
		this._stderrTail = "";
		this._killingForCrash = false;

		const requestedStderr = this._serverParams.stderr ?? "inherit";
		// Upgrade inherit → pipe so we can watch for panics while still teeing
		// to the parent stderr (same visible UX as inherit).
		const childStderr =
			requestedStderr === "inherit" || requestedStderr === undefined
				? "pipe"
				: requestedStderr;

		return new Promise((resolve, reject) => {
			this._process = spawn(
				this._serverParams.command,
				this._serverParams.args ?? [],
				{
					env: {
						...getDefaultEnvironment(),
						...this._serverParams.env,
					},
					stdio: ["pipe", "pipe", childStderr],
					shell: false,
					windowsHide: true,
					cwd: this._serverParams.cwd,
				},
			);

			this._process.on("error", (error: Error) => {
				reject(error);
				this.onerror?.(error);
			});

			this._process.on("spawn", () => {
				resolve();
			});

			// `exit` fires as soon as the process dies; `close` waits for all stdio
			// streams to finish. On Windows crashes, pipes can linger and delay
			// `close` for tens of seconds — so fail pending MCP calls on `exit`.
			this._process.on("exit", (code, signal) => {
				this.handleProcessEnded(code, signal);
			});

			this._process.on("close", (code, signal) => {
				this.handleProcessEnded(
					code ?? this._exitCode,
					signal ?? this._exitSignal,
				);
			});

			this._process.stdin?.on("error", (error: Error) => {
				this.onerror?.(error);
			});

			this._process.stdout?.on("data", (chunk: Buffer) => {
				this._readBuffer.append(chunk);
				this.processReadBuffer();
			});

			this._process.stdout?.on("error", (error: Error) => {
				this.onerror?.(error);
			});

			if (this._process.stderr) {
				this._process.stderr.on("data", (chunk: Buffer) => {
					this.onStderrData(chunk);
				});
				this._process.stderr.on("error", (error: Error) => {
					this.onerror?.(error);
				});
			}
		});
	}

	get stderr(): Stream | null {
		return this._stderrStream;
	}

	get pid(): number | null {
		return this._process?.pid ?? null;
	}

	private onStderrData(chunk: Buffer): void {
		// Tee to parent so operators still see the same output as with inherit.
		try {
			process.stderr.write(chunk);
		} catch {
			/* ignore */
		}
		try {
			this._stderrStream?.write(chunk);
		} catch {
			/* ignore */
		}

		if (this._ended || this._killingForCrash || this._intentionalClose) {
			return;
		}

		this._stderrTail = (this._stderrTail + chunk.toString("utf8")).slice(-8192);
		const match = this._stderrTail.match(FATAL_STDERR_RE);
		if (!match) return;

		const line =
			this._stderrTail
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean)
				.slice(-3)
				.join(" | ") || match[0];

		this._crashReason = `MCP server process panicked: ${line.slice(0, 400)}`;
		this.killForFatalStderr();
	}

	/** Kill a still-alive child that emitted fatal stderr (e.g. Rust thread panic). */
	private killForFatalStderr(): void {
		if (this._killingForCrash || this._ended) return;
		this._killingForCrash = true;

		const proc = this._process;
		try {
			proc?.kill("SIGKILL");
		} catch {
			/* ignore */
		}

		// If the process tree ignores SIGKILL / is a stuck npx wrapper, force
		// Protocol teardown so pending callTool promises reject immediately.
		setTimeout(() => {
			if (!this._ended) {
				this.handleProcessEnded(null, "SIGKILL");
			}
		}, 250).unref();
	}

	/**
	 * Idempotent process-death handler. Surfaces exit metadata via `onerror`
	 * (unless we closed intentionally) and always fires `onclose` so the SDK
	 * Protocol layer rejects in-flight requests.
	 */
	private handleProcessEnded(
		code: number | null,
		signal: NodeJS.Signals | null,
	): void {
		if (this._ended) return;
		this._ended = true;
		this._exitCode = code;
		this._exitSignal = signal;

		const proc = this._process;
		this._process = undefined;

		// Destroy lingering pipes so `close` can settle and nothing hangs waiting
		// on EOF after the child has already exited.
		try {
			proc?.stdout?.destroy();
		} catch {
			/* ignore */
		}
		try {
			proc?.stdin?.destroy();
		} catch {
			/* ignore */
		}
		try {
			proc?.stderr?.destroy();
		} catch {
			/* ignore */
		}

		if (!this._intentionalClose) {
			if (this._crashReason) {
				this.onerror?.(new Error(this._crashReason));
			} else {
				const parts: string[] = [];
				if (code != null) parts.push(`code=${code}`);
				if (signal) parts.push(`signal=${signal}`);
				const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
				this.onerror?.(
					new Error(`MCP server process exited unexpectedly${detail}`),
				);
			}
		}

		this.onclose?.();
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
		this._intentionalClose = true;
		if (this._process) {
			const processToClose = this._process;
			const closePromise = new Promise<void>((resolve) => {
				processToClose.once("close", () => {
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
					processToClose.kill("SIGTERM");
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
					processToClose.kill("SIGKILL");
				} catch {
					// ignore
				}
			}
			// Ensure onclose fires even if kill raced oddly.
			this.handleProcessEnded(
				processToClose.exitCode,
				processToClose.signalCode,
			);
		} else if (!this._ended) {
			this.handleProcessEnded(this._exitCode, this._exitSignal);
		}
		this._readBuffer.clear();
		try {
			this._stderrStream?.end();
		} catch {
			/* ignore */
		}
	}

	send(message: JSONRPCMessage): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this._process?.stdin) {
				reject(new Error("Not connected"));
				return;
			}
			const json = serializeMessage(message);
			if (this._process.stdin.write(json)) {
				resolve();
			} else {
				this._process.stdin.once("drain", resolve);
			}
		});
	}
}

/** Exported for unit tests. */
export function detectFatalStderr(text: string): boolean {
	return FATAL_STDERR_RE.test(text);
}
