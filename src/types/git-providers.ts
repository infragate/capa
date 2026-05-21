/**
 * A git host provider (e.g. GitHub, GitLab) — used for OAuth, repo URL parsing,
 * raw-content URLs, and API calls. Parallel to ProviderIntegration but for git
 * hosts rather than agent IDEs.
 */
export interface GitProvider {
  /** Internal id (lowercase, no dots), e.g. 'github', 'gitlab'. */
  id: string
  /** Host with no scheme, e.g. 'github.com', 'gitlab.com'. */
  host: string
  /** Display name for CLI output, e.g. 'GitHub'. */
  displayName: string
  /** Emoji prefix used in some CLI output, e.g. '🐙'. */
  emoji?: string
  /** OAuth authorization URL (where the user is redirected to authorize). */
  oauthAuthUrl: string
  /** OAuth token URL (where capa exchanges code for token). */
  oauthTokenUrl: string
  /** Refresh-token URL (often same as token URL). */
  oauthRefreshUrl?: string
  /** API endpoint that returns the authenticated user (for ping/verify). */
  apiUserUrl: string
  /** Regex matching raw-content URLs for this host (e.g. raw.githubusercontent.com). */
  rawUrlPattern: RegExp
  /**
   * Parse a raw-content URL into its components. Returns null if the URL
   * doesn't belong to this provider.
   */
  parseRawUrl: (url: string) => { owner: string; repo: string; ref: string; path: string } | null
  /** Parse a repository browser URL (e.g. github.com/owner/repo/tree/ref/path). */
  parseRepoUrl?: (url: string) => { owner: string; repo: string; ref?: string; path?: string } | null
  /** Build the Authorization header value for an access token. */
  authHeader: (token: string) => string
  /** Provider param value used when delegating to the capa cloud OAuth proxy. */
  cloudOAuthProviderParam: string
}
