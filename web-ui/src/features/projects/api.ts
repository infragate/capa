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

  get: (projectId: string) =>
    api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  getVariables: (projectId: string) =>
    api.get<VariablesResponse>(`/api/projects/${encodeURIComponent(projectId)}/variables`),

  saveVariables: (projectId: string, variables: Record<string, string>) =>
    api.post<ActionResponse>(`/api/projects/${encodeURIComponent(projectId)}/variables`, variables),

  getOAuth2Servers: (projectId: string) =>
    api.get<OAuth2ServersResponse>(`/api/projects/${encodeURIComponent(projectId)}/oauth-servers`),

  startOAuth: (projectId: string, serverId: string) =>
    api.post<OAuthStartResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/oauth/start?server=${encodeURIComponent(serverId)}`,
    ),

  disconnectOAuth: (projectId: string, serverId: string) =>
    api.delete<ActionResponse>(`/api/projects/${encodeURIComponent(projectId)}/oauth/${encodeURIComponent(serverId)}`),

  getServerTools: (projectId: string, serverId: string) =>
    api.get<ServerToolsResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/servers/${encodeURIComponent(serverId)}/tools`,
    ),
};
