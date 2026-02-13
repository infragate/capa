// Git URL parser and provider detection utilities

export interface ParsedGitUrl {
  provider: string;      // 'github.com', 'gitlab.com', 'github.example.com'
  providerType: 'github' | 'gitlab';
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
  isPrivate?: boolean;  // Determined by domain (non-official = likely private)
}

/**
 * Check if a domain is an official/public Git provider
 */
export function isOfficialDomain(domain: string): boolean {
  return domain === 'github.com' || domain === 'gitlab.com';
}

/**
 * Detect provider type from domain
 */
export function detectProviderType(domain: string): 'github' | 'gitlab' | null {
  if (domain.includes('github')) {
    return 'github';
  }
  if (domain.includes('gitlab')) {
    return 'gitlab';
  }
  return null;
}

/**
 * Parse a Git URL and extract provider information
 * Supports:
 * - https://github.com/owner/repo
 * - https://raw.githubusercontent.com/owner/repo/branch/path
 * - https://api.github.com/repos/owner/repo
 * - https://gitlab.com/owner/repo
 * - https://gitlab.com/owner/repo/-/raw/branch/path
 * - https://github.example.com/owner/repo (self-hosted)
 * - git@github.com:owner/repo.git
 */
export function parseGitUrl(url: string): ParsedGitUrl | null {
  try {
    // Handle SSH URLs: git@github.com:owner/repo.git
    const sshMatch = url.match(/^git@([\w.-]+):([\w-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (sshMatch) {
      const [, domain, owner, repo] = sshMatch;
      const providerType = detectProviderType(domain);
      if (!providerType) return null;

      return {
        provider: domain,
        providerType,
        owner,
        repo,
        isPrivate: !isOfficialDomain(domain),
      };
    }

    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const providerType = detectProviderType(domain);
    
    if (!providerType) return null;

    // GitHub raw URLs: https://raw.githubusercontent.com/owner/repo/branch/path
    if (domain === 'raw.githubusercontent.com') {
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length < 3) return null;
      
      const [owner, repo, branch, ...pathSegments] = pathParts;
      return {
        provider: 'github.com',
        providerType: 'github',
        owner,
        repo,
        branch,
        path: pathSegments.join('/'),
        isPrivate: false, // Raw URLs typically for public repos
      };
    }

    // GitHub API URLs: https://api.github.com/repos/owner/repo
    if (domain === 'api.github.com') {
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts[0] === 'repos' && pathParts.length >= 3) {
        return {
          provider: 'github.com',
          providerType: 'github',
          owner: pathParts[1],
          repo: pathParts[2],
          isPrivate: false, // Will be determined by API response
        };
      }
    }

    // Standard GitHub/GitLab URLs: https://github.com/owner/repo
    // or https://github.example.com/owner/repo (self-hosted)
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    
    if (pathParts.length < 2) return null;

    let owner = pathParts[0];
    let repo = pathParts[1];
    let branch: string | undefined;
    let path: string | undefined;

    // Remove .git suffix if present
    repo = repo.replace(/\.git$/, '');

    // Parse tree/blob URLs: /owner/repo/tree/branch/path or /owner/repo/blob/branch/path
    if (pathParts.length > 3 && (pathParts[2] === 'tree' || pathParts[2] === 'blob')) {
      branch = pathParts[3];
      if (pathParts.length > 4) {
        path = pathParts.slice(4).join('/');
      }
    }

    // GitLab raw URL: /owner/repo/-/raw/branch/path
    if (providerType === 'gitlab' && pathParts.includes('-') && pathParts.includes('raw')) {
      const rawIndex = pathParts.indexOf('raw');
      if (rawIndex > 0 && pathParts.length > rawIndex + 1) {
        branch = pathParts[rawIndex + 1];
        if (pathParts.length > rawIndex + 2) {
          path = pathParts.slice(rawIndex + 2).join('/');
        }
      }
    }

    return {
      provider: domain,
      providerType,
      owner,
      repo,
      branch,
      path,
      isPrivate: !isOfficialDomain(domain),
    };
  } catch (error) {
    return null;
  }
}

/**
 * Construct raw file URL for a Git provider
 */
export function constructRawUrl(parsed: ParsedGitUrl, filePath: string, branch: string = 'main'): string {
  const branchToUse = parsed.branch || branch;
  
  if (parsed.providerType === 'github') {
    if (parsed.provider === 'github.com') {
      return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branchToUse}/${filePath}`;
    } else {
      // Self-hosted GitHub
      return `https://${parsed.provider}/${parsed.owner}/${parsed.repo}/raw/${branchToUse}/${filePath}`;
    }
  } else if (parsed.providerType === 'gitlab') {
    return `https://${parsed.provider}/${parsed.owner}/${parsed.repo}/-/raw/${branchToUse}/${filePath}`;
  }
  
  throw new Error(`Unsupported provider type: ${parsed.providerType}`);
}

/**
 * Construct API URL for a Git provider
 */
export function constructApiUrl(parsed: ParsedGitUrl, endpoint: string = ''): string {
  if (parsed.providerType === 'github') {
    if (parsed.provider === 'github.com') {
      return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}${endpoint}`;
    } else {
      // Self-hosted GitHub Enterprise
      return `https://${parsed.provider}/api/v3/repos/${parsed.owner}/${parsed.repo}${endpoint}`;
    }
  } else if (parsed.providerType === 'gitlab') {
    // GitLab uses project ID or encoded path
    const projectPath = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
    if (parsed.provider === 'gitlab.com') {
      return `https://gitlab.com/api/v4/projects/${projectPath}${endpoint}`;
    } else {
      // Self-hosted GitLab
      return `https://${parsed.provider}/api/v4/projects/${projectPath}${endpoint}`;
    }
  }
  
  throw new Error(`Unsupported provider type: ${parsed.providerType}`);
}

/**
 * Check if a URL is from a Git provider
 */
export function isGitUrl(url: string): boolean {
  if (url.startsWith('git@')) {
    return true;
  }
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    return detectProviderType(domain) !== null;
  } catch {
    return false;
  }
}

/**
 * Extract provider domain from any Git URL
 */
export function extractProvider(url: string): string | null {
  const parsed = parseGitUrl(url);
  return parsed?.provider || null;
}
