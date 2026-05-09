/**
 * Shared helpers for fetching the *contents* of a single file from a remote
 * source (raw URL, GitHub repo, or GitLab repo).
 *
 * Two strategies are supported:
 *
 * 1. **Repo snapshot (preferred for `github` / `gitlab` typed sources):**
 *    Clone (or reuse) the repo via the cache layer and read the requested
 *    file off the local snapshot. Authentication for private repos works
 *    transparently because git clone embeds the OAuth token in the URL.
 *
 * 2. **Authenticated raw fetch (for `remote` typed sources):**
 *    Plain HTTP GET with optional bearer-token auth applied via
 *    `AuthenticatedFetch`. The response is validated to ensure we did not
 *    silently receive an HTML login redirect — a common failure mode for
 *    private GitLab projects behind SAML SSO that would otherwise be written
 *    verbatim into a `.md` / `.mdc` file.
 */

import { existsSync, readFileSync, readdirSync, type Dirent } from 'fs';
import { join, posix, relative, resolve, sep, win32 } from 'path';
import type { AuthenticatedFetch } from './authenticated-fetch';
import type { CachePlatform, GetSnapshotResult } from './cache';
import { parseRepoString, type ParsedRepo } from './repo-string';

/**
 * Reject repo-relative paths that would escape the snapshot directory when
 * joined with it — absolute paths, `..` segments, drive letters, etc. Used
 * by both `fetchRepoFile` (for rules / snippets) and the skill installer
 * (for `owner/repo::path/to/skill` references) so an attacker who controls
 * the capabilities file can't read arbitrary local files via a crafted
 * repo string like `owner/repo::../../etc/passwd`.
 *
 * Throws a descriptive Error when `target` is unsafe; returns the
 * normalized absolute path inside `rootDir` otherwise.
 */
export function assertSafeRepoPath(rootDir: string, target: string): string {
  if (!target) {
    throw new Error(`Invalid empty path inside repository.`);
  }
  // Reject absolute paths regardless of the host OS so a Windows-style path
  // can't slip past on Linux and vice versa. Includes:
  //   - POSIX absolute (`/etc/passwd`)
  //   - Windows absolute (`C:\…`, `\\server\share\…`)
  //   - "Root-relative" paths starting with a single separator
  //   - Bare drive-letter prefixes (`C:`, `D:`)
  if (
    posix.isAbsolute(target) ||
    win32.isAbsolute(target) ||
    /^[a-zA-Z]:/.test(target) ||
    target.startsWith('/') ||
    target.startsWith('\\')
  ) {
    throw new Error(
      `Invalid repository path "${target}": absolute paths are not allowed.`
    );
  }
  // Catches `..` and `..\` segments before they're collapsed by `resolve`.
  const segments = target.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new Error(
      `Invalid repository path "${target}": parent-directory segments ("..") are not allowed.`
    );
  }
  const resolved = resolve(rootDir, target);
  // Defense in depth: even if the segment check above somehow let something
  // through (encoding, OS-specific quirks), require the resolved path to
  // sit inside `rootDir`.
  const rootResolved = resolve(rootDir);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (resolved !== rootResolved && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      `Invalid repository path "${target}": resolves outside the repository root.`
    );
  }
  return resolved;
}

/**
 * Snapshot resolver signature. Matches the one defined in `install.ts` /
 * `plugin-install.ts`; duplicated here as an interface so this module can be
 * imported without creating a circular dependency.
 */
export type RepoSnapshotResolver = (
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts?: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean }
) => Promise<GetSnapshotResult>;

export interface FetchRepoFileOptions {
  /** Forwarded to the snapshot resolver — bypasses the on-disk cache. */
  noCache?: boolean;
}

export interface FetchRepoFileResult {
  /** File contents as UTF-8 text. */
  content: string;
  /** Resolved commit SHA the file was read at. */
  resolvedSha: string;
  /** Resolved version tag, when one was inferred (e.g. latest semver). */
  resolvedVersion: string | null;
  /** Parsed repo reference, exposed for callers that want to log it. */
  parsed: ParsedRepo;
}

/**
 * Fetch a file from a `github` / `gitlab` typed source by cloning the
 * containing repo (with OAuth credentials) and reading the file off the
 * resulting snapshot. Use this instead of constructing a raw URL when the
 * file may live in a private repo — git clone handles auth correctly while
 * raw URLs frequently redirect to an HTML login page.
 *
 * Two reference forms are supported (decided by `parseRepoString`):
 *   - `owner/repo::path/to/file.md`  — exact path from repo root
 *   - `owner/repo@file.md`           — recursive search by basename
 *
 * @param platform        `github` or `gitlab`
 * @param repoString      Repo reference in `@` (search) or `::` (exact) form
 * @param getRepoSnapshot Snapshot resolver (injected from `install.ts`)
 * @param authFetch       Auth helper used by the snapshot resolver
 */
export async function fetchRepoFile(
  platform: CachePlatform,
  repoString: string,
  getRepoSnapshot: RepoSnapshotResolver,
  authFetch: AuthenticatedFetch,
  options: FetchRepoFileOptions = {}
): Promise<FetchRepoFileResult> {
  const parsed = parseRepoString(repoString);

  const snapshot = await getRepoSnapshot(platform, parsed.ownerRepo, authFetch, {
    version: parsed.version,
    ref: parsed.sha,
    noCache: options.noCache,
  });

  const resolvedFilePath =
    parsed.mode === 'exact'
      ? resolveExactFile(snapshot.snapshotDir, parsed, snapshot.resolvedSha)
      : resolveBasenameMatch(snapshot.snapshotDir, parsed, snapshot.resolvedSha);

  const content = readFileSync(resolvedFilePath, 'utf-8');
  return {
    content,
    resolvedSha: snapshot.resolvedSha,
    resolvedVersion: snapshot.resolvedVersion,
    parsed,
  };
}

function resolveExactFile(
  snapshotDir: string,
  parsed: ParsedRepo,
  resolvedSha: string
): string {
  let filePath: string;
  try {
    filePath = assertSafeRepoPath(snapshotDir, parsed.target);
  } catch (err: any) {
    throw new Error(
      `${err.message} (repository: ${parsed.ownerRepo} @ ${resolvedSha.slice(0, 7)})`
    );
  }
  if (!existsSync(filePath)) {
    throw new Error(
      `File "${parsed.target}" not found in repository ${parsed.ownerRepo} ` +
      `at ${resolvedSha.slice(0, 7)}.`
    );
  }
  return filePath;
}

function resolveBasenameMatch(
  snapshotDir: string,
  parsed: ParsedRepo,
  resolvedSha: string
): string {
  const wanted = parsed.target;
  const matches = findFilesByBasename(snapshotDir, wanted);

  if (matches.length === 0) {
    const candidates = findCandidateFiles(snapshotDir, wanted, 8);
    const candidateHint = candidates.length > 0
      ? `\n    Files in repo (sample): ${candidates.join(', ')}`
      : '';
    throw new Error(
      `No file named "${wanted}" found in repository ${parsed.ownerRepo} ` +
      `at ${resolvedSha.slice(0, 7)}.${candidateHint}\n` +
      `    Tip: Use "${parsed.ownerRepo}::path/to/${wanted}" to reference an exact path.`
    );
  }

  if (matches.length > 1) {
    const sample = matches.slice(0, 8).join(', ');
    const more = matches.length > 8 ? `, … (${matches.length - 8} more)` : '';
    throw new Error(
      `Ambiguous reference: ${matches.length} files named "${wanted}" exist ` +
      `in repository ${parsed.ownerRepo} at ${resolvedSha.slice(0, 7)}.\n` +
      `    Matches: ${sample}${more}\n` +
      `    Tip: Use "${parsed.ownerRepo}::<exact-path>" to disambiguate.`
    );
  }

  return join(snapshotDir, matches[0]);
}

/**
 * Recursively walk `root` and return every file whose basename equals
 * `wanted`, expressed as forward-slash paths relative to `root`. Skips
 * `.git` and `node_modules` (other dotfile-prefixed dirs like `.cursor`,
 * `.github`, `.agents` are intentionally traversed because they're valid
 * locations for skill / rule content).
 */
function findFilesByBasename(root: string, wanted: string): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === wanted) {
        out.push(toRepoPath(root, full));
      }
    }
  }

  walk(root);
  return out;
}

/**
 * Heuristic helper for "no match" errors: surface up to `limit` files in the
 * repo whose basename shares the wanted file's extension (or is otherwise a
 * plausible candidate) so the user can spot typos quickly.
 */
function findCandidateFiles(root: string, wanted: string, limit: number): string[] {
  const wantedExt = wanted.includes('.') ? wanted.slice(wanted.lastIndexOf('.')) : '';
  const out: string[] = [];

  function walk(dir: string): void {
    if (out.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (!wantedExt || entry.name.endsWith(wantedExt)) {
          out.push(toRepoPath(root, full));
        }
      }
    }
  }

  walk(root);
  return out;
}

function toRepoPath(root: string, full: string): string {
  return relative(root, full).split(sep).join('/');
}

/**
 * Detect whether a response body looks like an HTML page rather than the
 * markdown / plain text we expected. Used to catch the common failure mode
 * where a private GitLab raw URL silently returns a SAML SSO login page with
 * a 200 status code instead of failing with 401/403.
 */
export function looksLikeHtmlPage(body: string, contentType: string | null): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) {
    return true;
  }
  const head = body.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<!doctype html>')) {
    return true;
  }
  if (/^<html[\s>]/i.test(head)) {
    return true;
  }
  return false;
}

export interface FetchTextFileOptions {
  /**
   * When provided, sends the request through `AuthenticatedFetch` so an
   * Authorization header is added if the host has a stored token.
   */
  authFetch?: AuthenticatedFetch;
  /**
   * Source label included in error messages (e.g. `rule "git-conventions"`).
   */
  sourceLabel?: string;
}

/**
 * Fetch a text file from a raw URL. Adds OAuth headers when an
 * `AuthenticatedFetch` helper is provided, and rejects responses that look
 * like HTML login pages — those almost always indicate the URL is gated
 * behind authentication that the raw fetch path cannot satisfy (e.g. SAML
 * SSO on GitLab). Callers should switch to a `github` / `gitlab` typed
 * source backed by `fetchRepoFile` in that case.
 */
export async function fetchTextFile(
  url: string,
  options: FetchTextFileOptions = {}
): Promise<string> {
  const { authFetch, sourceLabel } = options;
  const response = authFetch ? await authFetch.fetch(url) : await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${sourceLabel ? `${sourceLabel} from ` : ''}${url}: ` +
      `${response.status} ${response.statusText}`
    );
  }

  const contentType = response.headers.get('content-type');
  const body = await response.text();

  if (looksLikeHtmlPage(body, contentType)) {
    // Trailing space inside `where` so the message reads
    // `Refusing to install HTML response for <label> from <url>` (or, when
    // no label is provided, `Refusing to install HTML response from <url>`)
    // — without it the label glued straight onto "from".
    const where = sourceLabel ? `for ${sourceLabel} ` : '';
    throw new Error(
      `Refusing to install HTML response ${where}from ${url}.\n` +
      `    The server returned an HTML page (likely a login / SSO redirect) ` +
      `instead of the expected markdown.\n` +
      `    This typically happens when the URL points to a file in a private ` +
      `GitHub or GitLab repository.\n\n` +
      `    Fix: Replace the raw URL with a typed source so capa clones the ` +
      `repo using your stored OAuth token. For example:\n` +
      `      type: gitlab\n` +
      `      def:\n` +
      `        repo: owner/repo::path/to/file.md\n\n` +
      `    Make sure your account is connected on the integrations page (\`capa start\`).`
    );
  }

  return body;
}
