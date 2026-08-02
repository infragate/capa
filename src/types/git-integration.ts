// Git integration type definitions

export type GitPlatform = 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed';

export interface GitIntegrationConfig {
  platform: GitPlatform;
  host?: string; // For self-managed instances
  displayName: string;
  isConnected: boolean;
  expiresAt?: number;
  usesOAuth: boolean; // true for GitHub/GitLab cloud, false for PAT-based
}

export interface GitOAuthFlowState {
  state: string;
  platform: GitPlatform;
  code_verifier: string;
  redirect_uri: string;
}

export interface GitTokenData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export interface GitPATConfig {
  platform: GitPlatform;
  /** Required for github-enterprise / gitlab-self-managed; omit for cloud github/gitlab. */
  host?: string;
  token: string;
}
