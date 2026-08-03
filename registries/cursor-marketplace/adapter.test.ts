import { describe, expect, it } from 'bun:test';
import { pluginDef } from './adapter';

describe('cursor-marketplace pluginDef', () => {
  it('maps a root-level GitHub plugin without gitPath', () => {
    expect(pluginDef('https://github.com/acme/single-plugin')).toEqual({
      type: 'github',
      def: { repo: 'acme/single-plugin' },
    });
  });

  it('pins gitPath with ::subpath for monorepo listings', () => {
    expect(
      pluginDef('https://github.com/acme/plugins', 'nested/widget', 'abc123'),
    ).toEqual({
      type: 'github',
      def: { repo: 'acme/plugins::nested/widget', ref: 'abc123' },
    });
  });

  it('normalizes gitPath separators and trims slashes', () => {
    expect(pluginDef('https://github.com/acme/plugins', '\\foo\\bar\\')).toEqual({
      type: 'github',
      def: { repo: 'acme/plugins::foo/bar' },
    });
  });

  it('rejects traversal in gitPath', () => {
    expect(pluginDef('https://github.com/acme/plugins', '../escape')).toBeUndefined();
    expect(pluginDef('https://github.com/acme/plugins', 'ok/../nope')).toBeUndefined();
  });

  it('supports GitLab URLs', () => {
    expect(pluginDef('https://gitlab.com/group/proj.git', 'pkg')).toEqual({
      type: 'gitlab',
      def: { repo: 'group/proj::pkg' },
    });
  });
});

