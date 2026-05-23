import type { GitProvider } from '../../types/git-providers'
import {
  parseGithubRawUrl,
  parseGitlabRawUrl,
  parseGithubRepoUrl,
  parseGitlabRepoUrl,
} from './parsers'

export const gitProviders: Record<string, GitProvider> = {
  github: {
    id: 'github',
    host: 'github.com',
    displayName: 'GitHub',
    emoji: '🐙',
    oauthAuthUrl: 'https://github.com/login/oauth/authorize',
    oauthTokenUrl: 'https://github.com/login/oauth/access_token',
    apiUserUrl: 'https://api.github.com/user',
    rawUrlPattern: /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
    parseRawUrl(url) {
      return parseGithubRawUrl(url)
    },
    parseRepoUrl: parseGithubRepoUrl,
    authHeader: (token) => `token ${token}`,
    cloudOAuthProviderParam: 'github.com',
  },
  gitlab: {
    id: 'gitlab',
    host: 'gitlab.com',
    displayName: 'GitLab',
    emoji: '🦊',
    oauthAuthUrl: 'https://gitlab.com/oauth/authorize',
    oauthTokenUrl: 'https://gitlab.com/oauth/token',
    apiUserUrl: 'https://gitlab.com/api/v4/user',
    rawUrlPattern: /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
    parseRawUrl(url) {
      return parseGitlabRawUrl(url)
    },
    parseRepoUrl: parseGitlabRepoUrl,
    authHeader: (token) => `Bearer ${token}`,
    cloudOAuthProviderParam: 'gitlab.com',
  },
}

const HOST_ALIASES: Record<string, string> = {
  'raw.githubusercontent.com': 'github',
  'api.github.com': 'github',
}

export function getGitProvider(id: string): GitProvider | undefined {
  return gitProviders[id.toLowerCase()]
}

export function getGitProviderByHost(host: string): GitProvider | undefined {
  const h = host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const aliasId = HOST_ALIASES[h]
  if (aliasId) return gitProviders[aliasId]
  return Object.values(gitProviders).find((p) => p.host === h)
}

export function getAllGitProviders(): GitProvider[] {
  return Object.values(gitProviders)
}

export function parseGitRawUrl(url: string) {
  for (const p of Object.values(gitProviders)) {
    const r = p.parseRawUrl(url)
    if (r) return { provider: p, ...r }
  }
  return null
}
