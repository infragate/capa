/**
 * Shared helpers for parsing repo-string references used by skills, rules,
 * and agent snippets.  Format: `owner/repo@filepath[:version]` or `owner/repo@filepath[#sha]`.
 */

export interface ParsedRepo {
  ownerRepo: string;
  filepath: string;
  version?: string;
  sha?: string;
}

/**
 * Parse a repo-string into its components.
 * @throws if the format is invalid (missing `@`).
 */
export function parseRepoString(repo: string): ParsedRepo {
  const atIdx = repo.indexOf('@');
  if (atIdx === -1) {
    throw new Error(
      `Invalid repo format: "${repo}". Expected "owner/repo@filepath", ` +
      `optionally followed by ":version" or "#sha".`
    );
  }

  const ownerRepo = repo.slice(0, atIdx);
  const rest = repo.slice(atIdx + 1);

  const shaIdx = rest.lastIndexOf('#');
  if (shaIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, shaIdx), sha: rest.slice(shaIdx + 1) };
  }

  const colonIdx = rest.lastIndexOf(':');
  if (colonIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, colonIdx), version: rest.slice(colonIdx + 1) };
  }

  return { ownerRepo, filepath: rest };
}

/**
 * Build a raw-content URL for GitHub or GitLab given a parsed repo reference.
 */
export function buildRawUrl(platform: 'github' | 'gitlab', parsed: ParsedRepo): string {
  const ref = parsed.sha ?? parsed.version ?? 'HEAD';
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${parsed.ownerRepo}/${ref}/${parsed.filepath}`;
  }
  return `https://gitlab.com/${parsed.ownerRepo}/-/raw/${ref}/${parsed.filepath}`;
}
