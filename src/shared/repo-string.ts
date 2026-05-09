/**
 * Shared helpers for parsing repo-string references used by skills, rules,
 * and agent snippets.
 *
 * Two separator forms are supported, with very different resolution semantics:
 *
 *   `owner/repo@<name>[:version | #sha]`
 *     The right-hand side is a **basename**. Capa walks the cloned snapshot
 *     looking for an entry that matches that name:
 *       - skills: a directory named `<name>` containing a `SKILL.md`
 *       - rules / agent snippets: a file whose basename equals `<name>`
 *     The right-hand side MUST NOT contain `/` — it's a name, not a path.
 *
 *   `owner/repo::<path>[:version | #sha]`
 *     The right-hand side is an **exact path** from the repo root.
 *     Used when you need to disambiguate (multiple files with the same
 *     basename), or when the repo layout is significant and you want the
 *     reference to break loudly if the file moves.
 *
 * Examples:
 *   "vercel-labs/agent-skills@web-researcher"
 *     → search the snapshot for a `web-researcher/` skill directory
 *   "acme/group/sub/project::rules/git-conventions.md"
 *     → read exactly `<repo>/rules/git-conventions.md`
 *   "my-org/standards::skills/general/git-conventions:v1.2.0"
 *     → exact directory at the v1.2.0 tag
 */

/** How the right-hand side of a repo string should be resolved against a snapshot. */
export type RepoTargetMode = 'search' | 'exact';

export interface ParsedRepo {
  /** "owner/repo" or "group/.../subgroup/project". */
  ownerRepo: string;
  /**
   * The right-hand side as written:
   *   - `mode === 'search'` → a basename to look up recursively
   *   - `mode === 'exact'`  → a path from the repo root
   */
  target: string;
  /** Resolution strategy for `target`. */
  mode: RepoTargetMode;
  /** Pinned tag or branch (`:version` suffix). */
  version?: string;
  /** Pinned commit SHA (`#sha` suffix). */
  sha?: string;
  /**
   * Back-compat alias for `target`. Older code referred to the right-hand
   * side as `filepath` regardless of mode; new code should prefer `target`
   * + `mode`. Kept as a non-enumerable accessor so JSON.stringify of a
   * parsed value stays clean.
   */
  readonly filepath: string;
}

const EXACT_SEPARATOR = '::';
const SEARCH_SEPARATOR = '@';

/**
 * Parse a repo-string into its components.
 *
 * @throws if the format is invalid (no `@` / `::` separator, slashes in a
 *   `@`-form name, or empty target).
 */
export function parseRepoString(repo: string): ParsedRepo {
  // `::` is checked first — both `@` and `::` should never appear together
  // in a valid string, but if they do the user almost certainly meant the
  // exact-path form, so we honor it.
  const exactIdx = repo.indexOf(EXACT_SEPARATOR);
  const searchIdx = repo.indexOf(SEARCH_SEPARATOR);

  let ownerRepo: string;
  let rest: string;
  let mode: RepoTargetMode;

  if (exactIdx !== -1) {
    ownerRepo = repo.slice(0, exactIdx);
    rest = repo.slice(exactIdx + EXACT_SEPARATOR.length);
    mode = 'exact';
  } else if (searchIdx !== -1) {
    ownerRepo = repo.slice(0, searchIdx);
    rest = repo.slice(searchIdx + SEARCH_SEPARATOR.length);
    mode = 'search';
  } else {
    throw new Error(
      `Invalid repo format: "${repo}". Expected one of:\n` +
      `    "owner/repo@<name>"      — recursive search by basename, or\n` +
      `    "owner/repo::<path>"     — exact path inside the repo,\n` +
      `  optionally followed by ":version" or "#sha".`
    );
  }

  if (!ownerRepo) {
    throw new Error(`Invalid repo format: "${repo}". Missing "owner/repo" before separator.`);
  }

  let target = rest;
  let version: string | undefined;
  let sha: string | undefined;

  const shaIdx = target.lastIndexOf('#');
  if (shaIdx !== -1) {
    sha = target.slice(shaIdx + 1);
    target = target.slice(0, shaIdx);
  } else {
    const colonIdx = target.lastIndexOf(':');
    if (colonIdx !== -1) {
      version = target.slice(colonIdx + 1);
      target = target.slice(0, colonIdx);
    }
  }

  if (!target) {
    throw new Error(
      `Invalid repo format: "${repo}". Missing target after "${mode === 'exact' ? '::' : '@'}" separator.`
    );
  }

  if (mode === 'search' && target.includes('/')) {
    throw new Error(
      `Invalid repo format: "${repo}".\n` +
      `    The "@" separator expects a basename (no slashes); got "${target}".\n` +
      `    To reference an exact path inside the repo, use "::" instead:\n` +
      `        ${ownerRepo}::${target}${suffixFor(version, sha)}`
    );
  }

  return Object.defineProperty(
    { ownerRepo, target, mode, version, sha } as ParsedRepo,
    'filepath',
    { get() { return this.target; }, enumerable: false, configurable: false }
  );
}

function suffixFor(version: string | undefined, sha: string | undefined): string {
  if (sha) return `#${sha}`;
  if (version) return `:${version}`;
  return '';
}

/**
 * Build a raw-content URL for GitHub or GitLab given a parsed repo reference.
 *
 * Only valid for `mode === 'exact'` — there's no raw URL for a basename
 * search since the actual file path isn't known yet.
 *
 * NOTE: Raw URLs do **not** authenticate well with private repos. GitLab in
 * particular silently returns an HTML SAML login page (with HTTP 200) for
 * private group projects, which then gets written verbatim into rule / skill
 * files when callers don't validate the response.
 *
 * Prefer `fetchRepoFile()` from `shared/repo-file.ts` for any case where the
 * source repository may be private — it goes through the cache + git-clone
 * path and uses stored OAuth tokens transparently.
 */
export function buildRawUrl(platform: 'github' | 'gitlab', parsed: ParsedRepo): string {
  if (parsed.mode !== 'exact') {
    throw new Error(
      `buildRawUrl requires an exact-path repo reference; got a search-form ` +
      `reference for "${parsed.ownerRepo}@${parsed.target}".`
    );
  }
  const ref = parsed.sha ?? parsed.version ?? 'HEAD';
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${parsed.ownerRepo}/${ref}/${parsed.target}`;
  }
  return `https://gitlab.com/${parsed.ownerRepo}/-/raw/${ref}/${parsed.target}`;
}
