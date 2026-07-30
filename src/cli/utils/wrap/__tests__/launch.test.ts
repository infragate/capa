import { describe, expect, mock, test, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';

const spawnCalls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];

class FakeChild extends EventEmitter {
  kill() {
    this.emit('close', 0, null);
  }
}

mock.module('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    spawnCalls.push({ cmd, args, opts });
    const child = new FakeChild();
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  },
}));

import { launchProvider } from '../launch';
import type { ProviderIntegration } from '../../../../types/providers';

const claude: ProviderIntegration = {
  id: 'claude-code',
  displayName: 'Claude Code',
  wrap: { binary: 'claude', kind: 'cli' },
} as ProviderIntegration;

describe('launchProvider CLI', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  afterEach(() => {
    mock.restore();
  });

  test('spawns with inherited stdio and visible Windows console', async () => {
    const result = await launchProvider(claude, 'C:\\ws\\proj', ['--help']);
    expect(result.exitCode).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.cmd).toBe('claude');
    expect(spawnCalls[0]?.args).toEqual(['--help']);
    expect(spawnCalls[0]?.opts.stdio).toBe('inherit');
    expect(spawnCalls[0]?.opts.cwd).toBe('C:\\ws\\proj');
    expect(spawnCalls[0]?.opts.windowsHide).toBe(false);
    expect(spawnCalls[0]?.opts.shell).toBe(false);
  });
});
