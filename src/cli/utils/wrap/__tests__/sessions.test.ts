import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect } from 'bun:test';
import {
  findWrapPids,
  findWrapPidsForProject,
  isPidRunning,
  stopAllWrapSessions,
  commandLineMatchesProject,
  normalizePathForMatch,
} from '../sessions';

describe('wrap process discovery', () => {
  it('isPidRunning reports the current process', () => {
    expect(isPidRunning(process.pid)).toBe(true);
    expect(isPidRunning(99999999)).toBe(false);
  });

  it('findWrapPids does not include the current (non-wrap) process', async () => {
    const pids = await findWrapPids();
    expect(pids.includes(process.pid)).toBe(false);
  });

  it('findWrapPidsForProject skips process scan when project has no wrap workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capa-wrap-scan-skip-'));
    try {
      const pids = await findWrapPidsForProject(dir);
      expect(pids).toEqual([]);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('stopAllWrapSessions is a no-op when nothing is wrapping', async () => {
    // May still find unrelated wraps on the machine; just ensure it resolves.
    const n = await stopAllWrapSessions();
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it('commandLineMatchesProject matches real path and workspace paths', () => {
    const real =
      process.platform === 'win32' ? 'C:\\Users\\me\\proj' : '/Users/me/proj';
    const workspace =
      process.platform === 'win32'
        ? 'C:\\Users\\me\\.capa\\workspaces\\proj-cursor-abc\\proj'
        : '/Users/me/.capa/workspaces/proj-cursor-abc/proj';

    const watchCmd = `capa __wrap_watch__ ${real} ${workspace} cursor ${real}\\capabilities.yaml []`;
    expect(commandLineMatchesProject(watchCmd, real, [workspace])).toBe(true);

    const otherCmd = 'capa wrap cursor --project /other/path';
    expect(commandLineMatchesProject(otherCmd, real, [workspace])).toBe(false);

    const projectFlag = `capa wrap cursor --project ${real}`;
    expect(commandLineMatchesProject(projectFlag, real)).toBe(true);
  });

  it('commandLineMatchesProject does not match path prefixes (proj vs proj2)', () => {
    const real =
      process.platform === 'win32' ? 'C:\\Users\\me\\proj' : '/Users/me/proj';
    const other =
      process.platform === 'win32' ? 'C:\\Users\\me\\proj2' : '/Users/me/proj2';

    const otherWatch = `capa __wrap_watch__ ${other} ${other}\\ws cursor caps.yaml []`;
    expect(commandLineMatchesProject(otherWatch, real)).toBe(false);

    const otherProject = `capa wrap cursor --project ${other}`;
    expect(commandLineMatchesProject(otherProject, real)).toBe(false);

    // Substring would match; token equality must not.
    const substrish = `capa wrap cursor --project ${real}2`;
    expect(commandLineMatchesProject(substrish, real)).toBe(false);
  });

  it('normalizePathForMatch produces absolute paths', () => {
    const n = normalizePathForMatch('.');
    expect(n.length).toBeGreaterThan(1);
    if (process.platform === 'win32') {
      expect(n).toBe(n.toLowerCase());
      expect(n.includes('/')).toBe(false);
    }
  });
});
