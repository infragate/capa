import { describe, it, expect } from 'bun:test';
import { detectRepoCoordsFromRawUrl } from '../agents-file';
import { parseRepoString } from '../../../shared/repo-string';

describe('detectRepoCoordsFromRawUrl', () => {
  // Raw URLs always know an exact path inside the repo, so the translated
  // repo-string should use the `::` (exact) form so capa never falls back
  // into the recursive-search path it can't disambiguate.

  it('parses a raw.githubusercontent.com URL', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/main/AGENTS.md'
      )
    ).toEqual({ platform: 'github', repoString: 'owner/repo::AGENTS.md' });
  });

  it('parses a raw.githubusercontent.com URL with a SHA', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/abc1234567/docs/tips.md'
      )
    ).toEqual({
      platform: 'github',
      repoString: 'owner/repo::docs/tips.md#abc1234567',
    });
  });

  it('parses a raw.githubusercontent.com URL with a tag ref', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/v1.2.0/AGENTS.md'
      )
    ).toEqual({
      platform: 'github',
      repoString: 'owner/repo::AGENTS.md:v1.2.0',
    });
  });

  it('parses a github.com /raw/ URL', () => {
    expect(
      detectRepoCoordsFromRawUrl('https://github.com/owner/repo/raw/main/AGENTS.md')
    ).toEqual({ platform: 'github', repoString: 'owner/repo::AGENTS.md' });
  });

  it('parses a gitlab.com -/raw/ URL with a top-level project', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://gitlab.com/group/project/-/raw/main/AGENTS.md'
      )
    ).toEqual({ platform: 'gitlab', repoString: 'group/project::AGENTS.md' });
  });

  it('parses a gitlab.com -/raw/ URL with a subgroup project', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://gitlab.com/acme/platform/data/pipeline/-/raw/main/AGENTS.md'
      )
    ).toEqual({
      platform: 'gitlab',
      repoString: 'acme/platform/data/pipeline::AGENTS.md',
    });
  });

  it('parses a gitlab.com URL with a nested filepath and a tag', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://gitlab.com/group/project/-/raw/v1.0.0/rules/git.md'
      )
    ).toEqual({
      platform: 'gitlab',
      repoString: 'group/project::rules/git.md:v1.0.0',
    });
  });

  it('emits values that round-trip through parseRepoString as exact paths', () => {
    // Sanity check: every translated URL must parse back as an `::` reference
    // so downstream consumers (fetchRepoFile, install) take the exact-path branch.
    const cases = [
      'https://raw.githubusercontent.com/owner/repo/main/AGENTS.md',
      'https://raw.githubusercontent.com/owner/repo/abc1234567/docs/tips.md',
      'https://raw.githubusercontent.com/owner/repo/v1.2.0/AGENTS.md',
      'https://github.com/owner/repo/raw/main/docs/foo.md',
      'https://gitlab.com/group/project/-/raw/main/AGENTS.md',
      'https://gitlab.com/group/sub/sub2/project/-/raw/v1.0.0/rules/x.md',
    ];
    for (const url of cases) {
      const detected = detectRepoCoordsFromRawUrl(url);
      expect(detected).not.toBeNull();
      const parsed = parseRepoString(detected!.repoString);
      expect(parsed.mode).toBe('exact');
    }
  });

  it('returns null for unrecognized hosts', () => {
    expect(
      detectRepoCoordsFromRawUrl('https://example.com/some/file.md')
    ).toBeNull();
    expect(
      detectRepoCoordsFromRawUrl('https://gist.githubusercontent.com/u/r/raw/file.md')
    ).toBeNull();
  });

  it('returns null for github.com URLs that are not /raw/ paths', () => {
    expect(
      detectRepoCoordsFromRawUrl('https://github.com/owner/repo/blob/main/AGENTS.md')
    ).toBeNull();
  });

  it('returns null for gitlab URLs missing the -/raw/ separator', () => {
    expect(
      detectRepoCoordsFromRawUrl('https://gitlab.com/group/project/main/AGENTS.md')
    ).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(detectRepoCoordsFromRawUrl('not a url')).toBeNull();
    expect(detectRepoCoordsFromRawUrl('')).toBeNull();
  });
});
