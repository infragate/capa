import { api } from '../../lib/api';
import type {
  ProjectsResponse,
  ProjectDetail,
  VariablesResponse,
  OAuth2ServersResponse,
  ServerToolsResponse,
  SkillContentResponse,
  OAuthStartResponse,
  ActionResponse,
  CapabilitiesMutationResponse,
  CapabilitySection,
} from '../../types/api';

export const projectsApi = {
  list: () => api.get<ProjectsResponse>('/api/projects'),

  get: (projectId: string) =>
    api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  getVariables: (projectId: string) =>
    api.get<VariablesResponse>(`/api/projects/${encodeURIComponent(projectId)}/variables`),

  saveVariables: (projectId: string, variables: Record<string, string>) =>
    api.post<ActionResponse>(`/api/projects/${encodeURIComponent(projectId)}/variables`, variables),

  putVariable: (projectId: string, name: string, value = '') =>
    api.put<ActionResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(name)}`,
      { value },
    ),

  deleteVariable: (projectId: string, name: string) =>
    api.delete<ActionResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(name)}`,
    ),

  getOAuth2Servers: (projectId: string) =>
    api.get<OAuth2ServersResponse>(`/api/projects/${encodeURIComponent(projectId)}/oauth-servers`),

  startOAuth: (projectId: string, serverId: string) =>
    api.post<OAuthStartResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/oauth/start?server=${encodeURIComponent(serverId)}`,
    ),

  disconnectOAuth: (projectId: string, serverId: string) =>
    api.delete<ActionResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/oauth/${encodeURIComponent(serverId)}`,
    ),

  getServerTools: (projectId: string, serverId: string) =>
    api.get<ServerToolsResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/servers/${encodeURIComponent(serverId)}/tools`,
    ),

  getSkillContent: (projectId: string, skillId: string) =>
    api.get<SkillContentResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillId)}/content`,
    ),

  appendCapability: (projectId: string, section: CapabilitySection, entry: Record<string, unknown>) =>
    api.post<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/${section}`,
      entry,
    ),

  updateCapability: (
    projectId: string,
    section: CapabilitySection,
    entryId: string,
    patch: Record<string, unknown>,
  ) =>
    api.patch<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/${section}/${encodeURIComponent(entryId)}`,
      patch,
    ),

  deleteCapability: (
    projectId: string,
    section: CapabilitySection,
    entryId: string,
    opts?: { cascadeTools?: boolean },
  ) => {
    const qs = opts?.cascadeTools ? '?cascadeTools=true' : '';
    return api.delete<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/${section}/${encodeURIComponent(entryId)}${qs}`,
    );
  },

  reorderCapability: (projectId: string, section: CapabilitySection, ids: string[]) =>
    api.put<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/${section}/order`,
      { ids },
    ),

  patchOptions: (projectId: string, patch: Record<string, unknown>) =>
    api.patch<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/options`,
      patch,
    ),

  addFromRegistry: (
    projectId: string,
    section: 'skills' | 'plugins',
    body: { registry: string; itemId: string; capability?: 'skills' | 'plugins' },
  ) =>
    api.post<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/${section}/from-registry`,
      body,
    ),
};
