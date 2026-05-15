import { describe, it, expect } from 'bun:test';
import { validatePluginDef, getPluginInstallId, splitOwnerRepo } from '../plugin-source';
import type { Plugin } from '../../types/plugin';

function mkPlugin(opts: { type: Plugin['type']; def: Plugin['def']; id?: string; servers?: Plugin['servers'] }): Plugin {
  return opts;
}

describe('validatePluginDef', () => {
  describe('valid entries', () => {
    it('accepts GitHub two-segment repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.platform).toBe('github');
        expect(result.repoPath).toBe('owner/repo');
        expect(result.subpath).toBe('');
      }
    });

    it('strips .git suffix from repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo.git' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.repoPath).toBe('owner/repo');
      }
    });

    it('accepts GitLab two-segment repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'gitlab', def: { repo: 'group/project' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.platform).toBe('gitlab');
        expect(result.repoPath).toBe('group/project');
      }
    });

    it('accepts GitLab nested groups (3 segments)', () => {
      const result = validatePluginDef(mkPlugin({ type: 'gitlab', def: { repo: 'group/sub/project' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.repoPath).toBe('group/sub/project');
      }
    });

    it('accepts GitLab deeply nested groups (5 segments)', () => {
      const result = validatePluginDef(mkPlugin({ type: 'gitlab', def: { repo: 'a/b/c/d/project' } }));
      expect('error' in result).toBe(false);
    });

    it('accepts single-segment subpath', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: 'plugins' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.subpath).toBe('plugins');
      }
    });

    it('accepts multi-segment subpath', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: 'plugins/frontend-design' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.subpath).toBe('plugins/frontend-design');
      }
    });

    it('preserves version and ref', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', version: 'v1.0.0', ref: 'abc123' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.version).toBe('v1.0.0');
        expect(result.ref).toBe('abc123');
      }
    });

    it('extracts an @<name> suffix from def.repo as a recursive-search target', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo@code-review' } }));
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.repoPath).toBe('owner/repo');
        expect(result.search).toBe('code-review');
        expect(result.subpath).toBe('');
      }
    });

    it('extracts a ::<path> suffix from def.repo as an exact subpath', () => {
      const result = validatePluginDef(
        mkPlugin({ type: 'github', def: { repo: 'owner/repo::plugins/frontend-design' } })
      );
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.repoPath).toBe('owner/repo');
        expect(result.subpath).toBe('plugins/frontend-design');
        expect(result.search).toBeUndefined();
      }
    });

    it('treats def.subpath as equivalent to the ::<path> suffix', () => {
      const a = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: 'plugins/x' } }));
      const b = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo::plugins/x' } }));
      if ('error' in a || 'error' in b) throw new Error('expected both to validate');
      expect(a.repoPath).toBe(b.repoPath);
      expect(a.subpath).toBe(b.subpath);
    });
  });

  describe('rejection cases', () => {
    it('rejects unsupported plugin type', () => {
      const result = validatePluginDef({ type: 'remote' as any, def: { repo: 'owner/repo' } as any });
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('Unsupported plugin type');
    });

    it('rejects missing def.repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: {} as any }));
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('Missing required field');
    });

    it('rejects GitHub repo with more than 2 segments', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'a/b/c' } }));
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('exactly "owner/repo"');
    });

    it('rejects GitLab repo with less than 2 segments', () => {
      const result = validatePluginDef(mkPlugin({ type: 'gitlab', def: { repo: 'single' } }));
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('at least two segments');
    });

    it('rejects empty segment in repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects . segment in repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: './repo' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects .. segment in repo', () => {
      const result = validatePluginDef(mkPlugin({ type: 'gitlab', def: { repo: 'group/../project' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects . subpath', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: '.' } }));
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('subpath');
    });

    it('rejects .. subpath segment', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: 'plugins/../escape' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects empty subpath segment', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo', subpath: 'plugins//empty' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects empty repo string', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: '' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects @<name> search with an embedded slash (steers users to ::)', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo@plugins/code-review' } }));
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('contains a slash');
    });

    it('rejects @ with an empty search name', () => {
      const result = validatePluginDef(mkPlugin({ type: 'github', def: { repo: 'owner/repo@' } }));
      expect('error' in result).toBe(true);
    });

    it('rejects def.subpath combined with a ::<path> suffix in def.repo', () => {
      const result = validatePluginDef(
        mkPlugin({ type: 'github', def: { repo: 'owner/repo::plugins/x', subpath: 'plugins/x' } })
      );
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('conflicts');
    });

    it('rejects def.subpath combined with an @<name> suffix in def.repo', () => {
      const result = validatePluginDef(
        mkPlugin({ type: 'github', def: { repo: 'owner/repo@code-review', subpath: 'plugins/code-review' } })
      );
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('cannot be combined');
    });
  });
});

describe('getPluginInstallId', () => {
  it('slugifies a name', () => {
    expect(getPluginInstallId('My Plugin')).toBe('my-plugin');
  });

  it('strips leading/trailing dashes', () => {
    expect(getPluginInstallId('---hello---')).toBe('hello');
  });

  it('collapses multiple non-alnum chars', () => {
    expect(getPluginInstallId('a!!b$$c')).toBe('a-b-c');
  });

  it('does not append ref suffix (stable id)', () => {
    expect(getPluginInstallId('my-plugin')).toBe('my-plugin');
  });
});

describe('splitOwnerRepo', () => {
  it('splits GitHub two-segment path', () => {
    expect(splitOwnerRepo('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('splits GitLab nested groups path', () => {
    expect(splitOwnerRepo('group/sub/project')).toEqual({ owner: 'group/sub', repo: 'project' });
  });
});
