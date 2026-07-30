import { describe, it, expect } from 'bun:test';
import {
  getWrappableProvider,
  getWrappableProviders,
  getProviderOwnedTopLevelNames,
  collectWrapExclusionProviderIds,
} from '../index';

describe('wrap provider helpers', () => {
  it('lists wrappable providers that declare wrap', () => {
    const ids = getWrappableProviders().map((p) => p.id).sort();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex');
    expect(ids).toContain('cursor');
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
