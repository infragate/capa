import { describe, it, expect, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
	detectFatalStderr,
	HiddenStdioClientTransport,
} from "../stdio-client-transport";

function mockChildProcess(): childProcess.ChildProcess {
	const proc = new EventEmitter() as childProcess.ChildProcess;
	const stdin = new EventEmitter() as childProcess.ChildProcess["stdin"] &
		EventEmitter;
	Object.assign(stdin, {
		write: () => true,
		end: () => {},
		destroy: () => {},
	});
	const stdout = new EventEmitter() as childProcess.ChildProcess["stdout"] &
		EventEmitter;
	Object.assign(stdout, { destroy: () => {} });
	const stderr = new EventEmitter() as childProcess.ChildProcess["stderr"] &
		EventEmitter;
	Object.assign(stderr, { destroy: () => {}, pipe: () => stderr });
	Object.assign(proc, {
		pid: 12345,
		stdin,
		stdout,
		stderr,
		exitCode: null,
		signalCode: null,
		kill: () => {
			queueMicrotask(() => {
				(proc as any).exitCode = 1;
				proc.emit("exit", 1, null);
				proc.emit("close", 1, null);
			});
			return true;
		},
	});
	return proc;
}

describe("HiddenStdioClientTransport", () => {
	it("passes windowsHide: true when spawning the MCP server process", async () => {
		const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(((
			_command: string,
			_args: readonly string[] | undefined,
			options: childProcess.SpawnOptions,
		) => {
			expect(options.windowsHide).toBe(true);
			expect(options.stdio?.[2]).toBe("pipe");
			const proc = mockChildProcess();
			queueMicrotask(() => proc.emit("spawn"));
			return proc;
		}) as typeof childProcess.spawn);

		const transport = new HiddenStdioClientTransport({
			command: "npx",
			args: ["-y", "some-mcp-server"],
		});

		await transport.start();

		expect(spawnSpy).toHaveBeenCalled();
		spawnSpy.mockRestore();
	});

	it("fires onerror and onclose on process exit even before close", async () => {
		let proc: childProcess.ChildProcess | undefined;
		const spawnSpy = spyOn(childProcess, "spawn").mockImplementation((() => {
			proc = mockChildProcess();
			queueMicrotask(() => proc!.emit("spawn"));
			return proc!;
		}) as typeof childProcess.spawn);

		const transport = new HiddenStdioClientTransport({
			command: "fake-mcp",
			args: [],
		});

		await transport.start();
		spawnSpy.mockRestore();

		let closeCount = 0;
		let errorMessage: string | undefined;
		transport.onclose = () => {
			closeCount += 1;
		};
		transport.onerror = (err) => {
			errorMessage = err.message;
		};

		proc!.emit("exit", 101, null);

		expect(closeCount).toBe(1);
		expect(errorMessage).toContain("exited unexpectedly");
		expect(errorMessage).toContain("code=101");
		expect(transport.exitCode).toBe(101);

		proc!.emit("close", 101, null);
		expect(closeCount).toBe(1);
	});

	it("kills the child and closes when stderr shows a Rust panic without exit", async () => {
		let proc: childProcess.ChildProcess | undefined;
		const spawnSpy = spyOn(childProcess, "spawn").mockImplementation((() => {
			proc = mockChildProcess();
			queueMicrotask(() => proc!.emit("spawn"));
			return proc!;
		}) as typeof childProcess.spawn);

		const transport = new HiddenStdioClientTransport({ command: "fake-mcp" });
		await transport.start();
		spawnSpy.mockRestore();

		let closeCount = 0;
		let errorMessage: string | undefined;
		transport.onclose = () => {
			closeCount += 1;
		};
		transport.onerror = (err) => {
			errorMessage = err.message;
		};

		(proc!.stderr as EventEmitter).emit(
			"data",
			Buffer.from(
				"thread 'tokio-rt-worker' (1) panicked at src/lib.rs:468:13:\nnot yet implemented\n",
			),
		);

		await new Promise((r) => setTimeout(r, 50));

		expect(closeCount).toBe(1);
		expect(errorMessage).toMatch(/panicked/i);
		expect(transport.crashReason).toMatch(/panicked/i);
	});

	it("does not report unexpected exit when close() is intentional", async () => {
		let proc: childProcess.ChildProcess | undefined;
		const spawnSpy = spyOn(childProcess, "spawn").mockImplementation((() => {
			proc = mockChildProcess();
			queueMicrotask(() => proc!.emit("spawn"));
			return proc!;
		}) as typeof childProcess.spawn);

		const transport = new HiddenStdioClientTransport({
			command: "fake-mcp",
		});
		await transport.start();
		spawnSpy.mockRestore();

		let sawUnexpected = false;
		transport.onerror = (err) => {
			if (/exited unexpectedly|panicked/i.test(err.message)) {
				sawUnexpected = true;
			}
		};

		const closePromise = transport.close();
		proc!.emit("close", 0, null);
		await closePromise;

		expect(sawUnexpected).toBe(false);
	});

	it("detectFatalStderr matches Rust panic banners", () => {
		expect(
			detectFatalStderr(
				"thread 'tokio-rt-worker' (66228) panicked at C:\\x\\lib.rs:468:13:",
			),
		).toBe(true);
		expect(detectFatalStderr("info: all good")).toBe(false);
	});
});
