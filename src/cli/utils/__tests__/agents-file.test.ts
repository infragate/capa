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

  // GitHub's "Raw" button generates URLs of the form
  //   https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>
  // (and the equivalent `/refs/tags/<tag>/` form for tagged refs). The detector
  // must skip the `refs/heads/` (or `refs/tags/`) prefix when extracting the ref.
  it('parses a raw.githubusercontent.com URL with refs/heads/<branch>', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/refs/heads/main/AGENTS.md'
      )
    ).toEqual({ platform: 'github', repoString: 'owner/repo::AGENTS.md' });
  });

  it('parses a raw.githubusercontent.com URL with refs/heads/<branch> and a non-default branch', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/refs/heads/develop/docs/tips.md'
      )
    ).toEqual({
      platform: 'github',
      repoString: 'owner/repo::docs/tips.md:develop',
    });
  });

  it('parses a raw.githubusercontent.com URL with refs/tags/<tag>', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/refs/tags/v1.2.0/AGENTS.md'
      )
    ).toEqual({
      platform: 'github',
      repoString: 'owner/repo::AGENTS.md:v1.2.0',
    });
  });

  it('parses a github.com /raw/refs/heads/<branch>/ URL', () => {
    expect(
      detectRepoCoordsFromRawUrl(
        'https://github.com/owner/repo/raw/refs/heads/main/AGENTS.md'
      )
    ).toEqual({ platform: 'github', repoString: 'owner/repo::AGENTS.md' });
  });

  it('nested filepath after refs/heads/<branch> survives intact', () => {
    // The full filepath must not get split across the refs/heads/main boundary.
    expect(
      detectRepoCoordsFromRawUrl(
        'https://raw.githubusercontent.com/owner/repo/refs/heads/main/examples/playwright-e2e-testing-automation.md'
      )
    ).toEqual({
      platform: 'github',
      repoString: 'owner/repo::examples/playwright-e2e-testing-automation.md',
    });
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
      'https://raw.githubusercontent.com/owner/repo/refs/heads/main/AGENTS.md',
      'https://raw.githubusercontent.com/owner/repo/refs/heads/develop/x/y/z.md',
      'https://raw.githubusercontent.com/owner/repo/refs/tags/v1.2.0/AGENTS.md',
      'https://github.com/owner/repo/raw/main/docs/foo.md',
      'https://github.com/owner/repo/raw/refs/heads/main/docs/foo.md',
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

  // ---- Multi-segment ref handling --------------------------------------
  // GitHub allows branch names containing `/` (e.g. `feature/foo`). Inside a
  // raw URL these slashes are usually written literally, which makes the
  // ref/path boundary ambiguous without an API call. Capa makes the
  // single-segment-ref assumption; the cases below pin down that behavior so
  // any future change is intentional.
  it('decodes percent-encoded slashes in the ref segment (round-trips correctly)', () => {
    // `feature%2Ffoo` ⇒ ref = `feature/foo`, path stays intact.
    const detected = detectRepoCoordsFromRawUrl(
      'https://raw.githubusercontent.com/owner/repo/refs/heads/feature%2Ffoo/AGENTS.md'
    );
    expect(detected).toEqual({
      platform: 'github',
      repoString: 'owner/repo::AGENTS.md:feature/foo',
    });
  });

  it('mis-splits literal multi-segment refs (documented limitation)', () => {
    // `.../refs/heads/feature/foo/AGENTS.md` is genuinely ambiguous in a
    // raw URL. We assume `feature` is the entire ref and the rest is the
    // path; users with branches containing `/` should URL-encode the slash
    // or switch to a typed `github` source with an explicit `def.repo`.
    const detected = detectRepoCoordsFromRawUrl(
      'https://raw.githubusercontent.com/owner/repo/refs/heads/feature/foo/AGENTS.md'
    );
    expect(detected).toEqual({
      platform: 'github',
      repoString: 'owner/repo::foo/AGENTS.md:feature',
    });
  });
});
