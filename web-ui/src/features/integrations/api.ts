import { api } from '../../lib/api';
import type {
  IntegrationsResponse,
  OAuthStartResponse,
  ActionResponse,
} from '../../types/api';

export const integrationsApi = {
  list: () => api.get<IntegrationsResponse>('/api/integrations'),

  startGitHubOAuth: () =>
    api.post<OAuthStartResponse>('/api/integrations/github/oauth/start'),

  startGitLabOAuth: () =>
    api.post<OAuthStartResponse>('/api/integrations/gitlab/oauth/start'),

  connectGitHubEnterprise: (host: string, token: string) =>
    api.post<ActionResponse>('/api/integrations/github-enterprise', { host, token }),

  connectGitLabSelfManaged: (host: string, token: string) =>
    api.post<ActionResponse>('/api/integrations/gitlab-self-managed', { host, token }),

  disconnect: (platform: string, host?: string) => {
    const path = host
      ? `/api/integrations/${platform}/${host}`
      : `/api/integrations/${platform}`;
    return api.delete<ActionResponse>(path);
  },
};
