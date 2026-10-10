import { describe, expect, it } from 'bun:test';
import { getAllProviders } from '../../../src/shared/providers';
import { PROVIDER_DISPLAY_NAMES, getProviderDisplayName } from './providers';

describe('PROVIDER_DISPLAY_NAMES', () => {
  it('mirrors the provider registry exactly', () => {
    const fromRegistry = Object.fromEntries(getAllProviders().map((p) => [p.id, p.displayName]));
    expect(PROVIDER_DISPLAY_NAMES).toEqual(fromRegistry);
  });

  it('resolves plugin-manifest aliases', () => {
    expect(getProviderDisplayName('claude')).toBe('Claude Code');
    expect(getProviderDisplayName('unknown-x')).toBe('unknown-x');
  });
});
