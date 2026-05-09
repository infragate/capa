import { describe, it, expect } from 'bun:test';
import { parseRepoString, buildRawUrl } from '../repo-string';

describe('parseRepoString', () => {
  describe('@ form (recursive search)', () => {
    it('parses a basic search-form reference', () => {
      const r = parseRepoString('owner/repo@skill-name');
      expect(r.ownerRepo).toBe('owner/repo');
      expect(r.target).toBe('skill-name');
      expect(r.mode).toBe('search');
      expect(r.version).toBeUndefined();
      expect(r.sha).toBeUndefined();
    });

    it('parses subgroup repos', () => {
      const r = parseRepoString('group/sub/sub2/project@my-skill');
      expect(r.ownerRepo).toBe('group/sub/sub2/project');
      expect(r.target).toBe('my-skill');
      expect(r.mode).toBe('search');
    });

    it('parses a tag suffix', () => {
      const r = parseRepoString('owner/repo@skill:v1.2.0');
      expect(r.target).toBe('skill');
      expect(r.version).toBe('v1.2.0');
      expect(r.sha).toBeUndefined();
    });

    it('parses a sha suffix', () => {
      const r = parseRepoString('owner/repo@skill#abc1234');
      expect(r.target).toBe('skill');
      expect(r.sha).toBe('abc1234');
      expect(r.version).toBeUndefined();
    });

    it('rejects targets containing a slash with a helpful error', () => {
      let err: Error | null = null;
      try {
        parseRepoString('owner/repo@some/path/skill.md');
      } catch (e: any) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/no slashes|expects a basename/i);
      expect(err!.message).toContain('::some/path/skill.md');
    });
  });

  describe(':: form (exact path)', () => {
    it('parses a basic exact-path reference', () => {
      const r = parseRepoString('owner/repo::rules/git-conventions.md');
      expect(r.ownerRepo).toBe('owner/repo');
      expect(r.target).toBe('rules/git-conventions.md');
      expect(r.mode).toBe('exact');
      expect(r.version).toBeUndefined();
      expect(r.sha).toBeUndefined();
    });

    it('parses subgroup repos', () => {
      const r = parseRepoString(
        'acme/platform/data/pipeline::rules/git-conventions.md'
      );
      expect(r.ownerRepo).toBe('acme/platform/data/pipeline');
      expect(r.target).toBe('rules/git-conventions.md');
      expect(r.mode).toBe('exact');
    });

    it('parses a tag suffix on an exact path', () => {
      const r = parseRepoString('owner/repo::rules/git.md:v1.2.0');
      expect(r.target).toBe('rules/git.md');
      expect(r.version).toBe('v1.2.0');
      expect(r.mode).toBe('exact');
    });

    it('parses a sha suffix on an exact path', () => {
      const r = parseRepoString('owner/repo::rules/git.md#abc1234');
      expect(r.target).toBe('rules/git.md');
      expect(r.sha).toBe('abc1234');
      expect(r.mode).toBe('exact');
    });

    it('parses paths with a single segment', () => {
      const r = parseRepoString('owner/repo::AGENTS.md');
      expect(r.target).toBe('AGENTS.md');
      expect(r.mode).toBe('exact');
    });
  });

  describe('errors', () => {
    it('rejects strings without any separator', () => {
      expect(() => parseRepoString('owner/repo')).toThrow(/Invalid repo format/);
    });

    it('rejects empty target after @', () => {
      expect(() => parseRepoString('owner/repo@')).toThrow(/Missing target/);
    });

    it('rejects empty target after ::', () => {
      expect(() => parseRepoString('owner/repo::')).toThrow(/Missing target/);
    });

    it('rejects missing owner/repo before separator', () => {
      expect(() => parseRepoString('@skill')).toThrow(/Missing "owner\/repo"/);
      expect(() => parseRepoString('::path/file.md')).toThrow(/Missing "owner\/repo"/);
    });
  });

  describe('back-compat', () => {
    it('exposes `filepath` as an alias for `target`', () => {
      const r = parseRepoString('owner/repo::rules/git.md');
      expect(r.filepath).toBe('rules/git.md');
    });
  });
});

describe('buildRawUrl', () => {
  it('builds a raw URL from an exact-path reference (github)', () => {
    const r = parseRepoString('owner/repo::AGENTS.md');
    expect(buildRawUrl('github', r)).toBe(
      'https://raw.githubusercontent.com/owner/repo/HEAD/AGENTS.md'
    );
  });

  it('honors the version suffix in the URL', () => {
    const r = parseRepoString('owner/repo::AGENTS.md:v1.0.0');
    expect(buildRawUrl('github', r)).toBe(
      'https://raw.githubusercontent.com/owner/repo/v1.0.0/AGENTS.md'
    );
  });

  it('honors the sha suffix in the URL', () => {
    const r = parseRepoString('owner/repo::AGENTS.md#abc1234');
    expect(buildRawUrl('gitlab', r)).toBe(
      'https://gitlab.com/owner/repo/-/raw/abc1234/AGENTS.md'
    );
  });

  it('refuses to build a URL from a search-form reference', () => {
    const r = parseRepoString('owner/repo@skill');
    expect(() => buildRawUrl('github', r)).toThrow(/exact-path/);
  });
});
