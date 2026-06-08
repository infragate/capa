import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { HiddenStdioClientTransport } from '../stdio-client-transport';

describe('HiddenStdioClientTransport', () => {
  beforeEach(() => {
    // no-op; spy restored after each test
  });

  it('passes windowsHide: true when spawning the MCP server process', async () => {
    const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(((
      command: string,
      args: readonly string[] | undefined,
      options: childProcess.SpawnOptions
    ) => {
      expect(command).toBe('npx');
      expect(options.windowsHide).toBe(true);
      const { EventEmitter } = require('events');
      const proc = new EventEmitter() as childProcess.ChildProcess;
      Object.assign(proc, { pid: 12345, stdin: { write: () => true, on: () => {}, once: () => {} }, stdout: { on: () => {} }, stderr: null });
      queueMicrotask(() => proc.emit('spawn'));
      return proc;
    }) as typeof childProcess.spawn);

    const transport = new HiddenStdioClientTransport({
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
      stderr: 'pipe',
    });

    await transport.start();

    expect(spawnSpy).toHaveBeenCalled();
    spawnSpy.mockRestore();
  });
});
