import { describe, expect, it } from 'bun:test';
import {
  exactReleaseVersion,
  resolveEmbeddedVersion,
  resolveInstallerFallbackVersion,
  versionFromGitDescribe,
} from '../resolve-version';

describe('resolveEmbeddedVersion', () => {
  it('keeps an exact tag when the worktree is dirty and GITHUB_REF is the branch', () => {
    // v2.2.3 was published from a branch workflow. bun install rewrote the
    // lockfile, git describe returned v2.2.3-dirty, and the old script
    // embedded package.json (1.0.0).
    expect(
      resolveEmbeddedVersion({
        githubRef: 'refs/heads/main',
        gitDescribe: 'v2.2.3-dirty',
        packageVersion: '1.0.0',
        stripDirty: true,
      }),
    ).toBe('2.2.3');
  });

  it('prefers RELEASE_REF over a branch GITHUB_REF and over git describe', () => {
    expect(
      resolveEmbeddedVersion({
        releaseRef: 'refs/tags/v9.9.9',
        githubRef: 'refs/heads/main',
        gitDescribe: 'v2.2.3-dirty',
        packageVersion: '1.0.0',
        stripDirty: true,
      }),
    ).toBe('9.9.9');
  });

  it('reads RELEASE_TAG when the ref cannot be overridden', () => {
    expect(
      resolveEmbeddedVersion({
        releaseTag: 'v2.2.3',
        githubRef: 'refs/heads/main',
        packageVersion: '1.0.0',
      }),
    ).toBe('2.2.3');
  });

  it('uses GITHUB_REF on a tag-triggered release', () => {
    expect(
      resolveEmbeddedVersion({
        githubRef: 'refs/tags/v2.2.2',
        gitDescribe: 'v2.2.2-dirty',
        packageVersion: '1.0.0',
      }),
    ).toBe('2.2.2');
  });

  it('marks a dirty exact tag outside CI instead of falling back to package.json', () => {
    expect(
      resolveEmbeddedVersion({
        githubRef: 'refs/heads/main',
        gitDescribe: 'v2.2.3-dirty',
        packageVersion: '1.0.0',
        stripDirty: false,
      }),
    ).toBe('2.2.3-dirty');
  });

  it('keeps the dev describe form, including a dirty suffix', () => {
    expect(versionFromGitDescribe('v2.2.3-5-gabcdef1-dirty')).toBe(
      '2.2.3-dev.5+abcdef1-dirty',
    );
    expect(versionFromGitDescribe('v2.2.3-5-gabcdef1-dirty', { stripDirty: true })).toBe(
      '2.2.3-dev.5+abcdef1',
    );
  });

  it('falls back to package.json when describe is only a hash', () => {
    expect(
      resolveEmbeddedVersion({
        githubRef: 'refs/heads/main',
        gitDescribe: 'e568f96',
        packageVersion: '1.0.0',
      }),
    ).toBe('1.0.0');
  });
});

describe('resolveInstallerFallbackVersion', () => {
  it('uses the tag from a dirty exact checkout', () => {
    expect(
      resolveInstallerFallbackVersion({
        githubRef: 'refs/heads/main',
        gitDescribe: 'v2.2.3-dirty',
        packageVersion: '1.0.0',
      }),
    ).toBe('2.2.3');
  });

  it('does not write a dev version into the installer fallback', () => {
    expect(exactReleaseVersion('v2.2.3-5-gabcdef')).toBeUndefined();
    expect(
      resolveInstallerFallbackVersion({
        gitDescribe: 'v2.2.3-5-gabcdef',
        packageVersion: '1.0.0',
      }),
    ).toBe('1.0.0');
  });
});
