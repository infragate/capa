/**
 * Parser for plugin URIs in capabilities.
 * Format: github:owner/repo | github:owner/repo:v1.0.0 | github:owner/repo#sha
 *         gitlab:owner/repo | gitlab:owner/repo:v1.0.0 | gitlab:owner/repo#sha
 */

export type PluginUriPlatform = 'github' | 'gitlab';

export interface ParsedPluginUri {
  platform: PluginUriPlatform;
  owner: string;
  repo: string;
  version?: string;  // tag/branch from :version
  ref?: string;      // commit sha from #sha
}

const URI_REGEX = /^(github|gitlab):([^/#:]+)\/([^/#:]+)(?::([^#]+))?(?:#(.+))?$/;

/**
 * Parse a plugin URI into platform, owner, repo, and optional version/ref.
 */
export function parsePluginUri(uri: string): ParsedPluginUri | null {
  const trimmed = uri.trim();
  const match = trimmed.match(URI_REGEX);
  if (!match) return null;

  const [, platform, owner, repo, version, ref] = match;
  if (!platform || !owner || !repo) return null;

  const normalizedPlatform = platform.toLowerCase() as PluginUriPlatform;
  if (normalizedPlatform !== 'github' && normalizedPlatform !== 'gitlab') {
    return null;
  }

  return {
    platform: normalizedPlatform,
    owner,
    repo: repo.replace(/\.git$/, ''),
    version: version || undefined,
    ref: ref || undefined,
  };
}

/**
 * Build a repo path string "owner/repo" for use with cloneRepository.
 */
export function getRepoPath(parsed: ParsedPluginUri): string {
  return `${parsed.owner}/${parsed.repo}`;
}

/**
 * Generate a stable plugin id from manifest name and ref/version for directory naming.
 */
export function getPluginInstallId(pluginName: string, refOrVersion?: string): string {
  const slug = pluginName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!refOrVersion) return slug;
  const shortRef = refOrVersion.length > 8 ? refOrVersion.slice(0, 8) : refOrVersion;
  return `${slug}-${shortRef}`;
}
