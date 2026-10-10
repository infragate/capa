import { describe, expect, it } from 'bun:test';
import {
  claudePluginsNativeInstall,
  nativeInstallSpawn,
  runNativePluginInstall,
} from '../native-plugin-install';

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

describe('nativeInstallSpawn', () => {
  const cmd = 'claude plugin install pdf@claude-plugins-official';
  const args = ['plugin', 'install', 'pdf@claude-plugins-official'];

  it('spawns a Windows executable without a shell', () => {
    expect(nativeInstallSpawn(cmd, 'win32', () => 'C:\\bin\\claude.exe')).toEqual({
      command: 'C:\\bin\\claude.exe',
      args,
      shell: false,
    });
  });

  it('spawns directly on non-Windows platforms', () => {
    expect(nativeInstallSpawn(cmd, 'darwin', () => '/usr/local/bin/claude')).toEqual({
      command: 'claude',
      args,
      shell: false,
    });
  });

  it('only uses cmd.exe for a .cmd shim', () => {
    expect(nativeInstallSpawn(cmd, 'win32', () => 'C:\\npm\\claude.cmd').shell).toBe(true);
  });

  it('refuses shell metacharacters on every platform', () => {
    for (const bad of [
      'claude plugin install pdf&calc.exe&@claude-plugins-official',
      'claude plugin install a|b@m',
      'claude plugin install %COMSPEC%@m',
      'claude plugin install a^b@m',
      'claude plugin install "a"@m',
      'claude plugin install $(id)@m',
      'claude plugin install a;b@m',
      'claude& plugin install a@m',
    ]) {
      for (const platform of ['win32', 'linux'] as const) {
        expect(() => nativeInstallSpawn(bad, platform, () => 'C:\\npm\\claude.cmd')).toThrow(
          /unsafe token/,
        );
      }
    }
  });
});
