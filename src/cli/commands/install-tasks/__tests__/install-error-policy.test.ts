import { describe, it, expect } from 'bun:test';
import type { InstallCtx } from '../context';
import {
  finishInstallBatch,
  getInstallErrorMode,
  raiseInstallError,
  recordInstallFailure,
} from '../install-error-policy';

function ctx(mode: 'warn' | 'stop'): InstallCtx {
  return {
    installErrorMode: mode,
    failed: 0,
    warnings: [],
    errors: [],
  } as unknown as InstallCtx;
}

describe('getInstallErrorMode', () => {
  it('defaults to warn', () => {
    expect(getInstallErrorMode({ skills: [], servers: [], tools: [] })).toBe('warn');
    expect(getInstallErrorMode({ skills: [], servers: [], tools: [], options: {} })).toBe(
      'warn',
    );
  });

  it('honors stop', () => {
    expect(
      getInstallErrorMode({
        skills: [],
        servers: [],
        tools: [],
        options: { onInstallError: 'stop' },
      }),
    ).toBe('stop');
  });
});

describe('raiseInstallError', () => {
  it('warns without throwing in warn mode', () => {
    const c = ctx('warn');
    raiseInstallError(c, 'git not found');
    expect(c.failed).toBe(1);
    expect(c.warnings).toEqual(['git not found']);
  });

  it('throws in stop mode', () => {
    const c = ctx('stop');
    expect(() => raiseInstallError(c, 'git not found')).toThrow('git not found');
    expect(c.failed).toBe(1);
  });
});

describe('recordInstallFailure', () => {
  it('stores batch errors separately from warnings', () => {
    const warnCtx = ctx('warn');
    recordInstallFailure(warnCtx, 'skill a failed');
    expect(warnCtx.warnings).toHaveLength(1);
    expect(warnCtx.errors).toHaveLength(0);

    const stopCtx = ctx('stop');
    recordInstallFailure(stopCtx, 'skill a failed');
    expect(stopCtx.errors).toHaveLength(1);
    expect(stopCtx.warnings).toHaveLength(0);
  });
});

describe('finishInstallBatch', () => {
  it('throws summary in stop mode', () => {
    const c = ctx('stop');
    expect(() => finishInstallBatch(c, 2, '2 skills failed')).toThrow('2 skills failed');
  });

  it('warns in warn mode', () => {
    const c = ctx('warn');
    finishInstallBatch(c, 2, '2 skills failed');
    expect(c.warnings).toEqual(['2 skills failed']);
  });
});
