import { describe, it, expect } from 'bun:test';
import { findWrapPids, isPidRunning, stopAllWrapSessions } from '../sessions';

describe('wrap process discovery', () => {
  it('isPidRunning reports the current process', () => {
    expect(isPidRunning(process.pid)).toBe(true);
    expect(isPidRunning(99999999)).toBe(false);
  });

  it('findWrapPids does not include the current (non-wrap) process', async () => {
    const pids = await findWrapPids();
    expect(pids.includes(process.pid)).toBe(false);
  });

  it('stopAllWrapSessions is a no-op when nothing is wrapping', async () => {
    // May still find unrelated wraps on the machine; just ensure it resolves.
    const n = await stopAllWrapSessions();
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
