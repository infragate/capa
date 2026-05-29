import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  cleanAgentsFile,
  detectRepoCoordsFromRawUrl,
  getTargetFilenames,
  installAgentsFile,
} from '../agents-file';
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

describe('getTargetFilenames', () => {
  // The registry-driven target file list is the contract that drives both
  // `installAgentsFile` (where to write) and `cleanAgentsFile` (where to
  // clean). Provider-only installs must not bleed marker blocks into files
  // the provider will never read — most importantly: `claude-code` must
  // only produce `CLAUDE.md`, never a stray `AGENTS.md`.

  it('returns only CLAUDE.md when claude-code is the only provider', () => {
    const files = getTargetFilenames(['claude-code']);
    expect(files).toEqual(['CLAUDE.md']);
    expect(files).not.toContain('AGENTS.md');
  });

  it('returns only AGENTS.md for universal-spec providers like codex', () => {
    expect(getTargetFilenames(['codex'])).toEqual(['AGENTS.md']);
  });

  it('returns the union when claude-code and an AGENTS.md provider are both active', () => {
    const files = getTargetFilenames(['claude-code', 'codex']);
    expect(new Set(files)).toEqual(new Set(['CLAUDE.md', 'AGENTS.md']));
  });

  it('returns the provider-declared filename for non-universal providers', () => {
    expect(getTargetFilenames(['github-copilot'])).toEqual(['.github/copilot-instructions.md']);
    expect(getTargetFilenames(['replit'])).toEqual(['replit.md']);
  });

  it('deduplicates filenames when multiple providers share one', () => {
    // Both `codex` and `cursor` write to AGENTS.md — exactly one entry expected.
    const files = getTargetFilenames(['codex', 'cursor']);
    expect(files).toEqual(['AGENTS.md']);
  });

  it('falls back to AGENTS.md when no providers are passed', () => {
    // Empty providers means "consider all registered providers" — and since
    // most declare AGENTS.md, that's the natural baseline. The fallback also
    // guarantees `cleanAgentsFile` has something to scan when invoked
    // without provider context.
    expect(getTargetFilenames([])).toContain('AGENTS.md');
  });

  it('falls back to AGENTS.md when every passed provider id is unknown', () => {
    // Defensive: bad ids in the capabilities file shouldn't make capa drop
    // cleanup behavior on the floor.
    expect(getTargetFilenames(['definitely-not-a-real-provider'])).toEqual(['AGENTS.md']);
  });
});

describe('installAgentsFile + cleanAgentsFile end-to-end', () => {
  // These tests pin down the two regressions that motivated the fix:
  //   1. claude-code-only installs must not write AGENTS.md.
  //   2. `agents.base` content must round-trip through clean — i.e. the file
  //      must be entirely deleted on `capa clean`, not left behind with
  //      orphan base content because the base was written raw.
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-agents-file-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes only CLAUDE.md (not AGENTS.md) for a claude-code-only install with inline snippets', async () => {
    await installAgentsFile(
      projectDir,
      {
        additional: [
          { id: 'team-notes', type: 'inline', content: '## Team notes\n\nHello.' },
        ],
      },
      ['claude-code'],
    );

    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);

    const claude = readFileSync(join(projectDir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('<!-- capa:start:team-notes -->');
    expect(claude).toContain('Hello.');
  });

  it('writes both CLAUDE.md and AGENTS.md when claude-code and an AGENTS-using provider are both active', async () => {
    await installAgentsFile(
      projectDir,
      {
        additional: [
          { id: 'shared', type: 'inline', content: 'Shared instructions.' },
        ],
      },
      ['claude-code', 'codex'],
    );

    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true);

    const claude = readFileSync(join(projectDir, 'CLAUDE.md'), 'utf8');
    const agents = readFileSync(join(projectDir, 'AGENTS.md'), 'utf8');
    expect(claude).toContain('Shared instructions.');
    expect(agents).toContain('Shared instructions.');
  });

  it('wraps agents.base content in a __base__ marker block so clean can remove it', async () => {
    // Local base file — keeps the test offline-friendly while still exercising
    // the same write/clean path as remote/github/gitlab bases.
    const basePath = join(projectDir, 'base.md');
    writeFileSync(basePath, '# Base instructions\n\nFrom the base file.\n', 'utf8');

    const capabilitiesPath = join(projectDir, 'capabilities.yaml');
    writeFileSync(capabilitiesPath, '# placeholder so dirname() works\n', 'utf8');

    await installAgentsFile(
      projectDir,
      {
        base: { type: 'local', path: './base.md' },
        additional: [
          { id: 'team', type: 'inline', content: '## Team additions' },
        ],
      },
      ['codex'],
      undefined,
      capabilitiesPath,
    );

    const agentsPath = join(projectDir, 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);
    const written = readFileSync(agentsPath, 'utf8');
    expect(written).toContain('<!-- capa:start:__base__ -->');
    expect(written).toContain('<!-- capa:end:__base__ -->');
    expect(written).toContain('From the base file.');
    expect(written).toContain('<!-- capa:start:team -->');

    cleanAgentsFile(projectDir, ['codex']);

    // The whole file was capa-managed, so it must be gone — not left with
    // an orphan copy of the base content (the bug this test guards against).
    expect(existsSync(agentsPath)).toBe(false);
  });

  it('preserves user content outside markers while still removing the __base__ block on clean', async () => {
    const basePath = join(projectDir, 'base.md');
    writeFileSync(basePath, 'Base content.\n', 'utf8');

    const capabilitiesPath = join(projectDir, 'capabilities.yaml');
    writeFileSync(capabilitiesPath, '# placeholder\n', 'utf8');

    // Simulate a user who hand-edited their AGENTS.md before configuring
    // `agents.base`. The pre-existing content must survive install and clean.
    const agentsPath = join(projectDir, 'AGENTS.md');
    writeFileSync(agentsPath, '# My project\n\nHand-written notes.\n', 'utf8');

    await installAgentsFile(
      projectDir,
      { base: { type: 'local', path: './base.md' } },
      ['codex'],
      undefined,
      capabilitiesPath,
    );

    const afterInstall = readFileSync(agentsPath, 'utf8');
    expect(afterInstall).toContain('Hand-written notes.');
    expect(afterInstall).toContain('<!-- capa:start:__base__ -->');
    expect(afterInstall).toContain('Base content.');

    cleanAgentsFile(projectDir, ['codex']);

    expect(existsSync(agentsPath)).toBe(true);
    const afterClean = readFileSync(agentsPath, 'utf8');
    expect(afterClean).toContain('Hand-written notes.');
    expect(afterClean).not.toContain('Base content.');
    expect(afterClean).not.toContain('capa:start');
  });

  it('re-running install with a different base replaces the base block in place', async () => {
    const basePath = join(projectDir, 'base.md');
    writeFileSync(basePath, 'First version.\n', 'utf8');

    const capabilitiesPath = join(projectDir, 'capabilities.yaml');
    writeFileSync(capabilitiesPath, '# placeholder\n', 'utf8');

    await installAgentsFile(
      projectDir,
      { base: { type: 'local', path: './base.md' } },
      ['codex'],
      undefined,
      capabilitiesPath,
    );

    writeFileSync(basePath, 'Second version.\n', 'utf8');

    await installAgentsFile(
      projectDir,
      { base: { type: 'local', path: './base.md' } },
      ['codex'],
      undefined,
      capabilitiesPath,
    );

    const written = readFileSync(join(projectDir, 'AGENTS.md'), 'utf8');
    expect(written).toContain('Second version.');
    expect(written).not.toContain('First version.');
    // Exactly one __base__ block — the upsert must not duplicate it.
    const starts = written.match(/<!-- capa:start:__base__ -->/g) ?? [];
    expect(starts).toHaveLength(1);
  });
});
