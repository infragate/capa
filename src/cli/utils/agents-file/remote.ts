import type { AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { fetchRepoFile, fetchTextFile, type RepoSnapshotResolver } from '../../../shared/repo-file';
import { parseGitRawUrl } from '../../../shared/git-providers/registry';
import { refSuffix } from '../../../shared/git-providers/parsers';
import { parseRepoString } from '../../../shared/repo-string';
import { taskLog } from '../../ui';

/**
 * Fetch a text file from a raw URL.
 *
 * Backwards-compatible wrapper around `fetchTextFile` from `shared/repo-file`.
 * The new helper additionally rejects HTML responses (which usually indicate
 * a private-repo login redirect that would otherwise be silently written
 * verbatim into AGENTS.md / CLAUDE.md).
 */
export async function fetchRemoteContent(
  url: string,
  options: { authFetch?: AuthenticatedFetch; sourceLabel?: string } = {}
): Promise<string> {
  return fetchTextFile(url, options);
}

/**
 * Context passed through `installAgentsFile` so it can clone private repos
 * via the existing snapshot/cache machinery instead of relying on raw HTTP
 * fetches that fail (silently!) on auth-gated GitLab / GitHub URLs.
 */
export interface RepoFetchContext {
  authFetch?: AuthenticatedFetch;
  getRepoSnapshot?: RepoSnapshotResolver;
  noCache?: boolean;
}

/**
 * Detect a github.com / gitlab.com raw-content URL and translate it back into
 * a `(platform, owner/repo@filepath[:ref])` triple suitable for
 * `fetchRepoFile`. Returns `null` for URLs that don't match a recognized
 * raw-content shape (those callers should fall back to plain HTTP fetch).
 *
 * Accepted shapes (GitHub):
 *   https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/refs/tags/<tag>/<path>
 *   https://github.com/<owner>/<repo>/raw/<ref>/<path>
 *   https://github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
 *
 * Accepted shape (GitLab):
 *   https://gitlab.com/<group/.../subgroup>/<repo>/-/raw/<ref>/<path>
 */
export function detectRepoCoordsFromRawUrl(
  rawUrl: string
): { platform: 'github' | 'gitlab'; repoString: string } | null {
  const parsed = parseGitRawUrl(rawUrl);
  if (!parsed) return null;

  const repoPath = parsed.provider.id === 'gitlab'
    ? parsed.owner
    : `${parsed.owner}/${parsed.repo}`;

  return {
    platform: parsed.provider.id as 'github' | 'gitlab',
    repoString: `${repoPath}::${parsed.path}${refSuffix(parsed.ref)}`,
  };
}

function deriveIdFromFilepath(filepath: string): string {
  return filepath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function resolveRepoSnippet(
  platform: 'github' | 'gitlab',
  snippet: { id?: string; def?: { repo: string } },
  ctx: RepoFetchContext
): Promise<{ id: string; body: string }> {
  if (!snippet.def?.repo) {
    throw new Error(
      `Agent snippet of type '${platform}' is missing a "def.repo" field.`
    );
  }
  const parsed = parseRepoString(snippet.def.repo);
  const id = snippet.id ?? deriveIdFromFilepath(parsed.filepath);
  if (!ctx.authFetch || !ctx.getRepoSnapshot) {
    throw new Error(
      `Cannot resolve ${platform} snippet "${id}" — repo snapshot resolver is not configured. ` +
      `This is a bug; please report it.`
    );
  }
  taskLog(`  Fetching ${platform} snippet "${id}" from ${snippet.def.repo}`);
  const result = await fetchRepoFile(
    platform,
    snippet.def.repo,
    ctx.getRepoSnapshot,
    ctx.authFetch,
    { noCache: ctx.noCache }
  );
  return { id, body: result.content };
}
