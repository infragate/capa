import { existsSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AuthenticatedFetch } from '../authenticated-fetch';
import { validateRepoPath } from './validate';
import {
  type CachePlatform,
  getRepoCacheDir,
  getRepoMirrorDir,
} from './paths';

const execAsync = promisify(exec);

/**
 * Build the authenticated git URL for cloning, embedding an OAuth token when
 * one is available.
 */
function buildAuthenticatedRepoUrl(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch
): string {
  validateRepoPath(repoPath);
  const baseHost = `${platform}.com`;
  const probeUrl = `https://${baseHost}/${repoPath}`;
  const hasAuth = authFetch.hasAuth(probeUrl);
  if (!hasAuth) {
    return `https://${baseHost}/${repoPath}.git`;
  }
  const token = authFetch.getTokenForUrl(probeUrl);
  return `https://oauth2:${token}@${baseHost}/${repoPath}.git`;
}

/**
 * Ensure a mirror clone exists for the given repo. If it doesn't, perform a
 * bare clone. If it does, leave it as-is — callers can request a fetch via
 * `fetchMirror()` when they need newer refs.
 *
 * Returns the mirror directory path.
 */
export async function ensureMirrorClone(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  repoUrl?: string
): Promise<string> {
  validateRepoPath(repoPath);
  const mirrorDir = getRepoMirrorDir(platform, repoPath);
  if (existsSync(mirrorDir)) {
    return mirrorDir;
  }
  mkdirSync(getRepoCacheDir(platform, repoPath), { recursive: true });
  const url = repoUrl ?? buildAuthenticatedRepoUrl(platform, repoPath, authFetch);
  await execAsync(`git clone --mirror "${url}" "${mirrorDir}"`);
  return mirrorDir;
}

/**
 * Update an existing mirror clone (`git remote update`). Used when a requested
 * version/ref isn't yet present in the mirror.
 */
export async function fetchMirror(mirrorDir: string): Promise<void> {
  await execAsync(`git -C "${mirrorDir}" remote update --prune`);
}

/**
 * Check whether the mirror already contains a given commit/tag/branch ref.
 * Returns the resolved full SHA or null if the ref is unknown.
 */
async function tryResolveRefInMirror(
  mirrorDir: string,
  ref: string
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `git -C "${mirrorDir}" rev-parse --verify "${ref}^{commit}"`
    );
    const sha = stdout.trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Discover the latest semver tag in a mirror clone. Returns null if there
 * are no version-shaped tags.
 */
async function findLatestVersionTag(mirrorDir: string): Promise<string | null> {
  const { stdout } = await execAsync(
    `git -C "${mirrorDir}" tag --list`
  );
  const tags = stdout.trim().split('\n').filter(Boolean);
  const versionTags = tags.filter((t) => /^v?\d+\.\d+\.\d+$/.test(t));
  if (versionTags.length === 0) return null;
  versionTags.sort((a, b) => {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [aMaj, aMin, aPat] = parse(a);
    const [bMaj, bMin, bPat] = parse(b);
    return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
  });
  return versionTags[0];
}

export interface ResolveOptions {
  /** Tag/branch requested in the capabilities file (e.g. "v1.2.3"). */
  version?: string;
  /** Commit SHA explicitly requested in the capabilities file. */
  ref?: string;
  /**
   * Commit SHA already pinned by an existing lockfile entry. When provided we
   * try to use it without hitting the network.
   */
  pinnedSha?: string;
}

export interface ResolveResult {
  /** Full 40-char commit SHA. */
  sha: string;
  /** The tag the SHA corresponds to (auto-discovered for unpinned installs), if any. */
  version: string | null;
}

/**
 * Resolve a (version|ref|pinned|HEAD) request to a concrete commit SHA against
 * a mirror clone. Will fetch the mirror at most once if the ref is unknown.
 */
export async function resolveRef(
  mirrorDir: string,
  opts: ResolveOptions
): Promise<ResolveResult> {
  const { version, ref, pinnedSha } = opts;

  if (pinnedSha) {
    const sha = await tryResolveRefInMirror(mirrorDir, pinnedSha);
    if (sha) return { sha, version: version ?? null };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, pinnedSha);
    if (sha2) return { sha: sha2, version: version ?? null };
    throw new Error(
      `Pinned commit ${pinnedSha} could not be found in repository at ${mirrorDir}`
    );
  }

  if (ref) {
    const sha = await tryResolveRefInMirror(mirrorDir, ref);
    if (sha) return { sha, version: null };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, ref);
    if (sha2) return { sha: sha2, version: null };
    throw new Error(`Commit ${ref} not found in repository at ${mirrorDir}`);
  }

  if (version) {
    const sha = await tryResolveRefInMirror(mirrorDir, version);
    if (sha) return { sha, version };
    await fetchMirror(mirrorDir);
    const sha2 = await tryResolveRefInMirror(mirrorDir, version);
    if (sha2) return { sha: sha2, version };
    throw new Error(`Tag/branch "${version}" not found in repository at ${mirrorDir}`);
  }

  // Unpinned: prefer the latest semver tag, fall back to HEAD of default branch.
  const latestTag = await findLatestVersionTag(mirrorDir);
  if (latestTag) {
    const sha = await tryResolveRefInMirror(mirrorDir, latestTag);
    if (sha) return { sha, version: latestTag };
  }
  const headSha = await tryResolveRefInMirror(mirrorDir, 'HEAD');
  if (headSha) return { sha: headSha, version: null };
  throw new Error(`Could not resolve HEAD in repository at ${mirrorDir}`);
}
