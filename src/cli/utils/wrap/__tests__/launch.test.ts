import { describe, expect, mock, test, beforeEach, afterEach } from 'bun:test';

const spawnSyncCalls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];

mock.module('node:child_process', () => ({
  spawnSync: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    spawnSyncCalls.push({ cmd, args, opts });
    return { status: 0, signal: null, error: undefined };
  },
  spawn: () => {
    throw new Error('async spawn should not be used for CLI wrap launch');
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
    spawnSyncCalls.length = 0;
  });

  afterEach(() => {
    mock.restore();
  });

  test('uses spawnSync with inherited stdio for a real TTY', async () => {
    const result = await launchProvider(claude, 'C:\\ws\\proj', ['--help']);
    expect(result.exitCode).toBe(0);
    expect(spawnSyncCalls).toHaveLength(1);
    expect(spawnSyncCalls[0]?.cmd).toBe('claude');
    expect(spawnSyncCalls[0]?.args).toEqual(['--help']);
    expect(spawnSyncCalls[0]?.opts.stdio).toBe('inherit');
    expect(spawnSyncCalls[0]?.opts.cwd).toBe('C:\\ws\\proj');
    expect(spawnSyncCalls[0]?.opts.windowsHide).toBe(false);
    expect(spawnSyncCalls[0]?.opts.shell).toBe(false);
  });
});
