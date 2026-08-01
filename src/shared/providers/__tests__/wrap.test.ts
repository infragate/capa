import { describe, it, expect } from 'bun:test';
import {
  getWrappableProvider,
  getWrappableProviders,
  getProviderOwnedTopLevelNames,
  collectWrapExclusionProviderIds,
  resolveWrapTarget,
  formatWrappableProviderList,
} from '../index';

describe('wrap provider helpers', () => {
  it('lists wrappable providers that declare wrap', () => {
    const ids = getWrappableProviders().map((p) => p.id).sort();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex');
    expect(ids).toContain('cursor');
    expect(ids).toContain('gemini-cli');
    expect(ids).toContain('opencode');
    expect(ids).toContain('github-copilot');
    expect(ids).toContain('qwen-code');
    expect(ids).toContain('kiro-cli');
    expect(ids).toContain('iflow-cli');
    expect(ids).toContain('kimi-cli');
  });

  it('resolves by registry id', () => {
    const p = getWrappableProvider('claude-code');
    expect(p?.id).toBe('claude-code');
    expect(p?.wrap?.binary).toBe('claude');
    expect(p?.wrap?.kind).toBe('cli');
  });

  it('resolves claude alias via pluginProviderId', () => {
    const p = getWrappableProvider('claude');
    expect(p?.id).toBe('claude-code');
    expect(p?.wrap).toBeDefined();
  });

  it('returns undefined for non-wrappable providers', () => {
    expect(getWrappableProvider('amp')).toBeUndefined();
    expect(getWrappableProvider('not-a-provider')).toBeUndefined();
  });

  it('cursor wrap is gui with wait-until-close args', () => {
    const wrap = getWrappableProvider('cursor')?.wrap;
    expect(wrap?.kind).toBe('gui');
    expect(wrap?.args).toEqual(['--new-window', '--wait']);
  });

  it('resolveWrapTarget maps agent alias to cursor CLI launch', () => {
    const target = resolveWrapTarget('agent');
    expect(target?.provider.id).toBe('cursor');
    expect(target?.wrap.binary).toBe('agent');
    expect(target?.wrap.kind).toBe('cli');
    expect(target?.token).toBe('agent');
  });

  it('resolveWrapTarget keeps cursor as GUI', () => {
    const target = resolveWrapTarget('cursor');
    expect(target?.provider.id).toBe('cursor');
    expect(target?.wrap.binary).toBe('cursor');
    expect(target?.wrap.kind).toBe('gui');
    expect(target?.wrap.args).toEqual(['--new-window', '--wait']);
  });

  it('resolveWrapTarget maps CLI providers to expected binaries', () => {
    expect(resolveWrapTarget('gemini-cli')?.wrap).toEqual({
      binary: 'gemini',
      kind: 'cli',
    });
    expect(resolveWrapTarget('opencode')?.wrap).toEqual({
      binary: 'opencode',
      kind: 'cli',
    });
    expect(resolveWrapTarget('github-copilot')?.wrap).toEqual({
      binary: 'copilot',
      kind: 'cli',
    });
    expect(resolveWrapTarget('copilot')?.provider.id).toBe('github-copilot');
    expect(resolveWrapTarget('copilot')?.wrap.binary).toBe('copilot');
    expect(resolveWrapTarget('qwen-code')?.wrap.binary).toBe('qwen');
    expect(resolveWrapTarget('kiro-cli')?.wrap.binary).toBe('kiro-cli');
    expect(resolveWrapTarget('iflow-cli')?.wrap.binary).toBe('iflow');
    expect(resolveWrapTarget('kimi-cli')?.wrap.binary).toBe('kimi');
  });

  it('formatWrappableProviderList includes wrap aliases', () => {
    const list = formatWrappableProviderList();
    expect(list).toContain('cursor (alias: agent)');
    expect(list).toContain('github-copilot (alias: copilot)');
    expect(list).toContain('claude-code (alias: claude)');
  });

  it('collectWrapExclusionProviderIds unions wrap target with capabilities providers', () => {
    expect(collectWrapExclusionProviderIds('cursor', ['cursor']).sort()).toEqual(['cursor']);
    expect(collectWrapExclusionProviderIds('claude', ['cursor']).sort()).toEqual([
      'claude-code',
      'cursor',
    ]);
    expect(collectWrapExclusionProviderIds('cursor', undefined)).toEqual(['cursor']);
  });

  it('getProviderOwnedTopLevelNames is scoped to the given providers', () => {
    const cursor = getProviderOwnedTopLevelNames(['cursor']);
    expect(cursor.has('.cursor')).toBe(true);
    expect(cursor.has('AGENTS.md')).toBe(true);
    expect(cursor.has('.claude')).toBe(false);
    expect(cursor.has('skills')).toBe(false);

    const openclaw = getProviderOwnedTopLevelNames(['openclaw']);
    expect(openclaw.has('skills')).toBe(true);

    const both = getProviderOwnedTopLevelNames(['cursor', 'claude-code']);
    expect(both.has('.cursor')).toBe(true);
    expect(both.has('.claude')).toBe(true);
    expect(both.has('CLAUDE.md')).toBe(true);
    expect(both.has('.mcp.json')).toBe(true);
  });
});
