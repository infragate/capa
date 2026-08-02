import { describe, expect, it } from 'bun:test';
import { claudePluginsNativeInstall, runNativePluginInstall } from '../native-plugin-install';

describe('claudePluginsNativeInstall', () => {
  it('synthesizes claude plugin install from item name', () => {
    expect(claudePluginsNativeInstall('frontend-design')).toEqual({
      providerIds: ['claude-code'],
      command: 'claude plugin install frontend-design@claude-plugins-official',
    });
  });

  it('prefers snippet def fields when present', () => {
    expect(
      claudePluginsNativeInstall('ignored', {
        plugin: 'code-review',
        marketplace: 'my-marketplace',
        command: 'claude plugin install code-review@my-marketplace',
      }),
    ).toEqual({
      providerIds: ['claude-code'],
      command: 'claude plugin install code-review@my-marketplace',
    });
  });
});

describe('runNativePluginInstall', () => {
  it('rejects empty commands', () => {
    expect(() => runNativePluginInstall('   ')).toThrow(/empty/i);
  });
});
