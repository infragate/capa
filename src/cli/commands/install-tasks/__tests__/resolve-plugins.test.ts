import { describe, it, expect } from 'bun:test';
import type { InstallCtx } from '../context';
import { reportPluginResults } from '../resolve-plugins';

const FAILED = 'Plugin "glab" failed to resolve and was skipped: No plugin manifest found';
const NOTE = 'Skill "handoff" is provided by plugins "a" and "b"';

function ctx(declared: number, resolved: number, mode: 'warn' | 'stop' = 'warn'): InstallCtx {
  return {
    installErrorMode: mode,
    failed: 0,
    failures: [],
    warnings: [],
    errors: [],
    capabilities: { plugins: Array.from({ length: declared }, (_, i) => ({ id: `p${i}` })) },
    capabilitiesToUse: { resolvedPlugins: Array.from({ length: resolved }, (_, i) => ({ id: `p${i}` })) },
  } as unknown as InstallCtx;
}

describe('reportPluginResults', () => {
  it('counts a failed plugin as a failure when the others resolved', () => {
    const c = ctx(2, 1);
    expect(reportPluginResults(c, { warnings: [FAILED, NOTE], failures: [FAILED] })).toBe(true);
    expect(c.failed).toBe(1);
    expect(c.failures).toEqual([FAILED]);
    // Reported once: as the failure, plus the unrelated warning.
    expect(c.warnings).toEqual([NOTE, FAILED]);
  });

  it('fails the plugin step when every plugin failed, without repeating the message', () => {
    const c = ctx(1, 0);
    expect(reportPluginResults(c, { warnings: [FAILED], failures: [FAILED] })).toBe(false);
    expect(c.failed).toBe(1);
    expect(c.warnings).toEqual([FAILED]);
  });

  it('leaves a clean resolve alone', () => {
    const c = ctx(2, 2);
    expect(reportPluginResults(c, { warnings: [NOTE], failures: [] })).toBe(true);
    expect(c.failed).toBe(0);
    expect(c.warnings).toEqual([NOTE]);
  });

  it('keeps a warning that only mentions the words as a warning', () => {
    // A resolved plugin's own diagnostic can echo any text, e.g. an mcp.json key.
    const echo = 'Plugin "ok" mcp.json: unknown field "failed to resolve and was skipped"';
    const c = ctx(1, 1);
    expect(reportPluginResults(c, { warnings: [echo], failures: [] })).toBe(true);
    expect(c.failed).toBe(0);
    expect(c.warnings).toEqual([echo]);
  });

  it('records the failure as an error in stop mode, so install exits non-zero', () => {
    const c = ctx(2, 1, 'stop');
    expect(reportPluginResults(c, { warnings: [FAILED], failures: [FAILED] })).toBe(true);
    expect(c.errors).toEqual([FAILED]);
  });
});
