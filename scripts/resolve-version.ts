/**
 * Resolve the capa release version stamped into the binary and installers.
 *
 * Tag-triggered releases expose the tag on GITHUB_REF. A publish job that
 * checks out an existing tag from a branch push cannot override GITHUB_REF
 * (Actions ignores overrides of default GITHUB_* variables), so RELEASE_REF
 * and RELEASE_TAG are honored first.
 *
 * `bun install` rewrites the lockfile before the build, so `git describe
 * --dirty` on an exact tag is `vX.Y.Z-dirty`. That string used to miss every
 * pattern and fall through to package.json (1.0.0).
 */

export interface ReleaseVersionInput {
  releaseRef?: string;
  releaseTag?: string;
  githubRef?: string;
  /** Output of `git describe`, or null when git is unavailable. */
  gitDescribe?: string | null;
  packageVersion?: string;
  /**
   * Drop a trailing `-dirty`. Release CI sets this because `bun install`
   * dirties the worktree, and an exact tag must still be reported as itself.
   */
  stripDirty?: boolean;
}

const EXACT_TAG = /^v?(\d+\.\d+\.\d+)$/;
const DEV_DESCRIBE = /^v?(\d+\.\d+\.\d+)-(\d+)-g([a-f0-9]+)$/;

export function versionFromTagName(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return undefined;
  return version;
}

/** `refs/tags/v1.2.3` → `1.2.3`. Other refs are ignored. */
export function versionFromRef(ref: string | undefined): string | undefined {
  if (!ref?.startsWith('refs/tags/')) return undefined;
  return versionFromTagName(ref.slice('refs/tags/'.length));
}

/**
 * Parse `git describe --tags --always --dirty` output.
 * Returns undefined when describe is only a commit hash.
 */
export function versionFromGitDescribe(
  gitDescribe: string,
  options?: { stripDirty?: boolean },
): string | undefined {
  const trimmed = gitDescribe.trim();
  const dirty = trimmed.endsWith('-dirty');
  const base = dirty ? trimmed.slice(0, -'-dirty'.length) : trimmed;
  const dirtySuffix = dirty && !options?.stripDirty ? '-dirty' : '';

  const exact = base.match(EXACT_TAG);
  if (exact?.[1]) return `${exact[1]}${dirtySuffix}`;

  const dev = base.match(DEV_DESCRIBE);
  if (dev?.[1] && dev[2] && dev[3]) {
    return `${dev[1]}-dev.${dev[2]}+${dev[3]}${dirtySuffix}`;
  }

  return undefined;
}

/** Exact release tag only (`1.2.3`), ignoring a dirty worktree. */
export function exactReleaseVersion(gitDescribe: string): string | undefined {
  const version = versionFromGitDescribe(gitDescribe, { stripDirty: true });
  if (version && /^\d+\.\d+\.\d+$/.test(version)) return version;
  return undefined;
}

export function versionFromReleaseEnv(env: {
  releaseRef?: string;
  releaseTag?: string;
  githubRef?: string;
}): string | undefined {
  return (
    versionFromRef(env.releaseRef) ??
    versionFromTagName(env.releaseTag) ??
    versionFromRef(env.githubRef)
  );
}

/** Version embedded in the compiled binary. */
export function resolveEmbeddedVersion(input: ReleaseVersionInput): string {
  const fromEnv = versionFromReleaseEnv(input);
  if (fromEnv) return fromEnv;

  if (input.gitDescribe) {
    const fromGit = versionFromGitDescribe(input.gitDescribe, {
      stripDirty: input.stripDirty,
    });
    if (fromGit) return fromGit;
  }

  if (input.packageVersion) return input.packageVersion;
  return '0.0.0-unknown';
}

/** Fallback version written into install.sh / install.ps1. */
export function resolveInstallerFallbackVersion(input: ReleaseVersionInput): string {
  const fromEnv = versionFromReleaseEnv(input);
  if (fromEnv) return fromEnv;

  if (input.gitDescribe) {
    const exact = exactReleaseVersion(input.gitDescribe);
    if (exact) return exact;
  }

  if (input.packageVersion) return input.packageVersion;
  return '0.0.0-unknown';
}
