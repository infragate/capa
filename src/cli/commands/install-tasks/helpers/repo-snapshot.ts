import { getOrCreateSnapshot, type CachePlatform, type GetSnapshotResult } from '../../../../shared/cache';
import type { AuthenticatedFetch } from '../../../../shared/authenticated-fetch';
import { explainGitError } from './git';

// Cache-aware replacement for the legacy `cloneRepository` helper. Returns a
// stable on-disk snapshot of the repo at the resolved commit SHA. The
// snapshot directory is owned by the cache and must NOT be deleted by callers.
export async function getRepoSnapshot(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean } = {}
): Promise<GetSnapshotResult> {
  const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
  try {
    return await getOrCreateSnapshot({
      platform,
      repoPath,
      authFetch,
      version: opts.version,
      ref: opts.ref,
      pinnedSha: opts.pinnedSha,
      noCache: opts.noCache,
    });
  } catch (error: any) {
    throw explainGitError(error, platform, repoPath, hasAuth);
  }
}
