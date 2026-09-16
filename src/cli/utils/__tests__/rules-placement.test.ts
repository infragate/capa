import { describe, it, expect } from 'bun:test';
import type { Rule } from '../../../types/rules';
import {
  computeInstructionLayout,
  planRulePlacement,
  resolveRuleConflictMode,
} from '../rules-placement';

const rule = (overrides: Partial<Rule> & { id: string }): Rule => ({
  type: 'inline',
  content: 'body',
  ...overrides,
});

const paths = (plan: ReturnType<typeof planRulePlacement>) =>
  Object.fromEntries([...plan.blocks].map(([path, blocks]) => [path, blocks.map((b) => b.ruleId)]));

describe('computeInstructionLayout', () => {
  it('keeps gemini-cli on AGENTS.md when it is the only reader', () => {
    const layout = computeInstructionLayout(['gemini-cli']);
    expect(layout.providerFile.get('gemini-cli')).toBe('AGENTS.md');
    expect(layout.contextConfig.get('gemini-cli')?.fileNames).toEqual(['AGENTS.md']);
  });

  it('isolates gemini-cli onto GEMINI.md when another provider reads AGENTS.md', () => {
    const layout = computeInstructionLayout(['codex', 'gemini-cli', 'cursor']);
    expect(layout.providerFile.get('gemini-cli')).toBe('GEMINI.md');
    expect(layout.files.get('AGENTS.md')).toEqual(['codex', 'cursor']);
    expect(layout.files.get('GEMINI.md')).toEqual(['gemini-cli']);
    expect(layout.contextConfig.get('gemini-cli')?.fileNames).toEqual(['GEMINI.md']);
  });

  it('does not depend on provider order', () => {
    const a = computeInstructionLayout(['codex', 'gemini-cli']);
    const b = computeInstructionLayout(['gemini-cli', 'codex']);
    expect([...a.files]).toEqual([...b.files]);
  });

  it('does not isolate for providers that read a different default file', () => {
    const layout = computeInstructionLayout(['claude-code', 'gemini-cli']);
    expect(layout.providerFile.get('gemini-cli')).toBe('AGENTS.md');
  });
});

describe('planRulePlacement', () => {
  it('places a codex-only rule in AGENTS.md without a conflict when gemini is isolated', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', providers: ['codex'] })],
      readerProviders: ['codex', 'gemini-cli'],
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['py'] });
    expect(plan.diagnostics).toEqual([]);
  });

  it('places a gemini-only rule in GEMINI.md when codex shares AGENTS.md', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'g', providers: ['gemini-cli'] })],
      readerProviders: ['codex', 'gemini-cli'],
    });
    expect(paths(plan)).toEqual({ 'GEMINI.md': ['g'] });
  });

  it('places an unrestricted rule in both files, each once', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'all' })],
      readerProviders: ['codex', 'gemini-cli', 'cursor'],
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['all'], 'GEMINI.md': ['all'] });
    expect(plan.diagnostics).toEqual([]);
  });

  it('reports a visibility conflict when cursor also reads AGENTS.md', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', providers: ['codex'] })],
      readerProviders: ['codex', 'cursor'],
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['py'] });
    expect(plan.diagnostics.map((d) => [d.code, d.level])).toEqual([['visibility-conflict', 'warn']]);
    expect(plan.diagnostics[0].message).toContain('cursor');
  });

  it('skips the rule under conflicts: error', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', providers: ['codex'] }), rule({ id: 'ok' })],
      readerProviders: ['codex', 'cursor'],
      conflicts: 'error',
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['ok'] });
    expect(plan.diagnostics.map((d) => d.level)).toEqual(['error']);
    expect(plan.diagnostics[0].message).toContain('the rule was skipped');
  });

  it('accepts widened visibility with visibility: best-effort', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', providers: ['codex'], visibility: 'best-effort' })],
      readerProviders: ['codex', 'cursor'],
      conflicts: 'error',
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['py'] });
    expect(plan.diagnostics).toEqual([]);
  });

  it('writes directory globs as nested files for hierarchical providers', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'api', appliesTo: ['./packages/api/**', 'packages/api/src/**/*'] })],
      readerProviders: ['codex', 'gemini-cli'],
    });
    expect(paths(plan)).toEqual({
      'packages/api/AGENTS.md': ['api'],
      'packages/api/GEMINI.md': ['api'],
    });
    expect(plan.diagnostics).toEqual([]);
  });

  it('folds non-directory globs at the root with a preamble and a scope diagnostic', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', appliesTo: ['**/*.py'] })],
      readerProviders: ['codex'],
    });
    expect(plan.blocks.get('AGENTS.md')).toEqual([
      { ruleId: 'py', preamble: '> Applies to: `**/*.py`' },
    ]);
    expect(plan.diagnostics.map((d) => d.code)).toEqual(['scope-not-representable']);
  });

  it('accepts widened scope with scope: best-effort', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', appliesTo: ['**/*.py'], scope: 'best-effort' })],
      readerProviders: ['codex'],
    });
    expect(plan.blocks.get('AGENTS.md')?.[0].preamble).toBe('> Applies to: `**/*.py`');
    expect(plan.diagnostics).toEqual([]);
  });

  it('splits mixed globs between nested files and the root', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'mix', appliesTo: ['src/**', '*.ts'], scope: 'best-effort' })],
      readerProviders: ['codex'],
    });
    expect(plan.blocks.get('src/AGENTS.md')).toEqual([{ ruleId: 'mix' }]);
    expect(plan.blocks.get('AGENTS.md')).toEqual([
      { ruleId: 'mix', preamble: '> Applies to: `*.ts`' },
    ]);
  });

  it('falls back to the root when a target is not hierarchical', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'api', appliesTo: ['src/**'], scope: 'best-effort' })],
      readerProviders: ['codex', 'opencode'],
    });
    expect(plan.blocks.get('AGENTS.md')?.[0].preamble).toBe('> Applies to: `src/**`');
    expect(plan.blocks.has('src/AGENTS.md')).toBe(false);
  });

  it('treats match-all globs and alwaysApply as unscoped', () => {
    const plan = planRulePlacement({
      rules: [
        rule({ id: 'a', appliesTo: ['**'] }),
        rule({ id: 'b', appliesTo: ['src/**'], alwaysApply: true }),
      ],
      readerProviders: ['codex'],
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['a', 'b'] });
    expect(plan.diagnostics).toEqual([]);
  });

  it('rejects globs that escape the project without widening scope', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'bad', appliesTo: ['../other/**'] })],
      readerProviders: ['codex'],
    });
    expect(plan.blocks.size).toBe(0);
    expect(plan.diagnostics.map((d) => d.code)).toEqual(['invalid-glob']);
  });

  it('only places blocks for target providers but counts every reader', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'py', providers: ['codex'] })],
      readerProviders: ['codex', 'cursor'],
      targetProviders: ['codex'],
    });
    expect(paths(plan)).toEqual({ 'AGENTS.md': ['py'] });
    expect(plan.diagnostics.map((d) => d.code)).toEqual(['visibility-conflict']);
  });

  it('ignores providers with a native rules directory', () => {
    const plan = planRulePlacement({
      rules: [rule({ id: 'c', providers: ['cursor'] })],
      readerProviders: ['codex', 'cursor'],
    });
    expect(plan.blocks.size).toBe(0);
    expect(plan.diagnostics).toEqual([]);
  });
});

describe('resolveRuleConflictMode', () => {
  it('defaults to warn, and to error under onInstallError: stop', () => {
    expect(resolveRuleConflictMode(undefined)).toBe('warn');
    expect(resolveRuleConflictMode({ onInstallError: 'stop' })).toBe('error');
    expect(resolveRuleConflictMode({ onInstallError: 'stop', rules: { conflicts: 'warn' } })).toBe(
      'warn',
    );
    expect(resolveRuleConflictMode({ rules: { conflicts: 'error' } })).toBe('error');
  });
});
