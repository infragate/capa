import { describe, expect, it } from 'bun:test';
import { resolveWrapConfigureProviders } from '../install';

describe('resolveWrapConfigureProviders', () => {
  it('prefers authored identity providers over the wrap provider', () => {
    expect(
      resolveWrapConfigureProviders({
        authoredProviders: ['cursor'],
        storedProviders: [],
        resolvedProviders: ['claude-code'],
      }),
    ).toEqual(['cursor']);
  });

  it('uses stored identity providers when authored is empty', () => {
    expect(
      resolveWrapConfigureProviders({
        authoredProviders: [],
        storedProviders: ['cursor'],
        resolvedProviders: ['claude-code'],
      }),
    ).toEqual(['cursor']);
  });

  it('falls back to the wrap provider when identity has none', () => {
    expect(
      resolveWrapConfigureProviders({
        authoredProviders: [],
        storedProviders: [],
        resolvedProviders: ['cursor'],
      }),
    ).toEqual(['cursor']);
  });
});
