import { describe, it, expect, mock, beforeEach } from 'bun:test';

const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

mock.module('cross-spawn', () => ({
  default: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    const proc = {
      pid: 12345,
      stdin: { write: () => true, on: () => {}, once: () => {} },
      stdout: { on: () => {} },
      stderr: null,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'spawn') {
          queueMicrotask(() => cb());
        }
      },
      kill: () => {},
    };
    return proc;
  },
}));

const { HiddenStdioClientTransport } = await import('../stdio-client-transport');

describe('HiddenStdioClientTransport', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  it('passes windowsHide: true when spawning the MCP server process', async () => {
    const transport = new HiddenStdioClientTransport({
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
      stderr: 'pipe',
    });

    await transport.start();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('npx');
    expect(spawnCalls[0].options.windowsHide).toBe(true);
  });
});
