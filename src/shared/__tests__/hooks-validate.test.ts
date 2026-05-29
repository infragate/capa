import { describe, it, expect } from 'bun:test';
import { validateHooks } from '../hooks-validate';

describe('validateHooks', () => {
  it('accepts a minimal canonical hook', () => {
    const { valid, issues } = validateHooks([
      { id: 'echo', on: 'sessionStart', command: 'echo hello' },
    ]);
    expect(issues).toEqual([]);
    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBe('echo');
    expect(valid[0].type).toBe('command');
  });

  it('accepts provider-scoped events', () => {
    const { valid, issues } = validateHooks([
      { id: 'cursor-only', on: 'cursor:beforeShellExecution', command: 'echo' },
    ]);
    expect(issues).toEqual([]);
    expect(valid).toHaveLength(1);
  });

  it('rejects unknown events', () => {
    const { valid, issues } = validateHooks([
      { id: 'broken', on: 'totallyMadeUp', command: 'echo' },
    ]);
    expect(valid).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].hookId).toBe('broken');
  });

  it('rejects entries missing id', () => {
    const { valid, issues } = validateHooks([{ on: 'sessionStart', command: 'echo' }]);
    expect(valid).toHaveLength(0);
    expect(issues[0].message).toContain("'id'");
  });

  it('rejects path-traversal hook ids', () => {
    const cases = [
      '../escape',
      'foo/bar',
      'foo\\bar',
      'a..b',
      '.hidden',
      '-leading-dash',
      'has spaces',
      'has;semicolon',
      'with$shell',
    ];
    for (const id of cases) {
      const { valid, issues } = validateHooks([{ id, on: 'sessionStart', command: 'echo' }]);
      expect(valid).toHaveLength(0);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/unsafe characters/);
    }
  });

  it('accepts safe hook ids', () => {
    const cases = ['ok', 'audit-shell', 'lint_staged', 'a.b.c', 'block-rm-rf', 'hook123'];
    for (const id of cases) {
      const { valid, issues } = validateHooks([{ id, on: 'sessionStart', command: 'echo' }]);
      expect(issues).toEqual([]);
      expect(valid).toHaveLength(1);
    }
  });

  it('skips duplicates after the first', () => {
    const { valid, issues } = validateHooks([
      { id: 'a', on: 'sessionStart', command: 'first' },
      { id: 'a', on: 'sessionStart', command: 'second' },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0].command).toBe('first');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('duplicate');
  });

  it('requires command for command-type without a source', () => {
    const { valid, issues } = validateHooks([{ id: 'noop', on: 'sessionStart' }]);
    expect(valid).toHaveLength(0);
    expect(issues[0].message).toContain('command');
  });

  it('accepts a github source with def.repo', () => {
    const { valid, issues } = validateHooks([
      {
        id: 'remote-hook',
        on: 'beforeShell',
        source: { type: 'github', def: { repo: 'owner/repo::scripts/before.sh' } },
      },
    ]);
    expect(issues).toEqual([]);
    expect(valid[0].source?.type).toBe('github');
  });

  it('rejects github source without def.repo', () => {
    const { valid, issues } = validateHooks([
      { id: 'broken', on: 'beforeShell', source: { type: 'github' } },
    ]);
    expect(valid).toHaveLength(0);
    expect(issues[0].message).toContain('def.repo');
  });
});
