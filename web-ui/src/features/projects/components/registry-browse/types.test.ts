import { describe, expect, it } from 'bun:test';
import { isRegistryItemInstalled, registryInstallId } from './types';

describe('registryInstallId', () => {
  it('uses the leaf path segment', () => {
    expect(registryInstallId('owner/repo/skill-name')).toBe('skill-name');
    expect(registryInstallId('skill-name')).toBe('skill-name');
  });

  it('prefers installSnippet.id when present', () => {
    expect(
      registryInstallId('owner/repo/display-name', { id: 'canonical-id' }),
    ).toBe('canonical-id');
  });
});

describe('isRegistryItemInstalled', () => {
  it('matches full id or install leaf id', () => {
    const installed = new Set(['skill-name', 'other']);
    expect(isRegistryItemInstalled('skill-name', installed)).toBe(true);
    expect(isRegistryItemInstalled('owner/repo/skill-name', installed)).toBe(true);
    expect(isRegistryItemInstalled('owner/repo/missing', installed)).toBe(false);
  });

  it('matches installSnippet.id when it differs from itemId/leaf', () => {
    const installed = new Set(['canonical-id']);
    expect(
      isRegistryItemInstalled('owner/repo/display-name', installed, {
        id: 'canonical-id',
      }),
    ).toBe(true);
    expect(
      isRegistryItemInstalled('owner/repo/display-name', installed),
    ).toBe(false);
  });

  it('does not treat a catalog id as installed when the snippet id differs', () => {
    const installed = new Set(['owner/repo/display-name']);
    expect(
      isRegistryItemInstalled('owner/repo/display-name', installed, {
        id: 'canonical-id',
      }),
    ).toBe(false);
  });
});
