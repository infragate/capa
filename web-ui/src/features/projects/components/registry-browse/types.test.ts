import { describe, expect, it } from 'bun:test';
import { isRegistryItemInstalled, registryInstallId } from './types';

describe('registryInstallId', () => {
  it('uses the leaf path segment', () => {
    expect(registryInstallId('owner/repo/skill-name')).toBe('skill-name');
    expect(registryInstallId('skill-name')).toBe('skill-name');
  });
});

describe('isRegistryItemInstalled', () => {
  it('matches full id or install leaf id', () => {
    const installed = new Set(['skill-name', 'other']);
    expect(isRegistryItemInstalled('skill-name', installed)).toBe(true);
    expect(isRegistryItemInstalled('owner/repo/skill-name', installed)).toBe(true);
    expect(isRegistryItemInstalled('owner/repo/missing', installed)).toBe(false);
  });
});
