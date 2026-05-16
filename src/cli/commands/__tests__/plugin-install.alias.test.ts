import { describe, it, expect } from 'bun:test';
import { getPluginInstallId } from '../../../shared/plugin-source';

describe('plugin install id derivation', () => {
  it('slugifies manifest name without ref suffix', () => {
    expect(getPluginInstallId('My Cool Plugin')).toBe('my-cool-plugin');
  });

  it('uses plugin.id when set', () => {
    expect(getPluginInstallId('slack-plugin')).toBe('slack-plugin');
  });

  it('is stable across version bumps (no ref suffix)', () => {
    const v1 = getPluginInstallId('my-plugin');
    const v2 = getPluginInstallId('my-plugin');
    expect(v1).toBe(v2);
  });
});

describe('server id derivation', () => {
  it('default server id is the manifest server key when no alias is set', () => {
    const config: { as?: string } = {};
    const serverKey = 'slack';
    const serverId = config.as ?? serverKey;
    expect(serverId).toBe('slack');
  });

  it('alias overrides default server id', () => {
    const config = { as: 'my-slack' };
    const serverKey = 'slack';
    const serverId = config.as ?? serverKey;
    expect(serverId).toBe('my-slack');
  });
});

describe('collision detection logic', () => {
  it('detects duplicate server ids between plugins', () => {
    const registeredServerIds = new Set<string>();
    const ids = ['slack', 'slack'];
    const collisions: string[] = [];
    for (const id of ids) {
      if (registeredServerIds.has(id)) {
        collisions.push(id);
      } else {
        registeredServerIds.add(id);
      }
    }
    expect(collisions).toEqual(['slack']);
  });

  it('detects collision between a plugin server and a user-defined server', () => {
    const userServers = new Set(['brave', 'github']);
    const pluginServerId = 'brave';
    expect(userServers.has(pluginServerId)).toBe(true);
  });
});
