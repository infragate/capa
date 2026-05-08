import { api } from '../../lib/api';
import type {
  ProjectsResponse,
  ProjectDetail,
  VariablesResponse,
  OAuth2ServersResponse,
  ServerToolsResponse,
  OAuthStartResponse,
  ActionResponse,
} from '../../types/api';

export const projectsApi = {
  list: () => api.get<ProjectsResponse>('/api/projects'),

  get: (projectId: string) => api.get<ProjectDetail>(`/api/projects/${projectId}`),

  getVariables: (projectId: string) =>
    api.get<VariablesResponse>(`/api/projects/${projectId}/variables`),

  saveVariables: (projectId: string, variables: Record<string, string>) =>
    api.post<ActionResponse>(`/api/projects/${projectId}/variables`, variables),

  getOAuth2Servers: (projectId: string) =>
    api.get<OAuth2ServersResponse>(`/api/projects/${projectId}/oauth-servers`),

  startOAuth: (projectId: string, serverId: string) =>
    api.post<OAuthStartResponse>(
      `/api/projects/${projectId}/oauth/start?server=${serverId}`,
    ),

  disconnectOAuth: (projectId: string, serverId: string) =>
    api.delete<ActionResponse>(`/api/projects/${projectId}/oauth/${serverId}`),

  getServerTools: (projectId: string, serverId: string) =>
    api.get<ServerToolsResponse>(
      `/api/projects/${projectId}/servers/${encodeURIComponent(serverId)}/tools`,
    ),
};
