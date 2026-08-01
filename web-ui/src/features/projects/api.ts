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
  ProjectFsListResponse,
  ProjectFsUploadResponse,
  AgentFileConfig,
  ActivityResponse,
  ActivityStats,
} from '../../types/api';

export const projectsApi = {
  list: () => api.get<ProjectsResponse>('/api/projects'),

  get: (projectId: string) =>
    api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  delete: (projectId: string) =>
    api.delete<ActionResponse>(`/api/projects/${encodeURIComponent(projectId)}`),

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

  getActivity: (projectId: string, opts?: { limit?: number; before?: number; beforeId?: string }) => {
    const params = new URLSearchParams();
    params.set('limit', String(opts?.limit ?? 50));
    if (opts?.before != null) params.set('before', String(opts.before));
    if (opts?.beforeId) params.set('beforeId', opts.beforeId);
    return api.get<ActivityResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/activity?${params}`,
    );
  },

  getActivityStats: (projectId: string) =>
    api.get<ActivityStats>(
      `/api/projects/${encodeURIComponent(projectId)}/activity/stats`,
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

  putAgents: (projectId: string, agents: AgentFileConfig | Record<string, unknown> | null) =>
    api.put<CapabilitiesMutationResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/capabilities/agents`,
      { agents },
    ),

  listFs: (
    projectId: string,
    opts?: { path?: string; ext?: string; dirsOnly?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.path) params.set('path', opts.path);
    if (opts?.ext) params.set('ext', opts.ext);
    if (opts?.dirsOnly) params.set('dirsOnly', 'true');
    const qs = params.toString();
    return api.get<ProjectFsListResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/fs${qs ? `?${qs}` : ''}`,
    );
  },

  uploadFs: async (
    projectId: string,
    file: File,
    opts?: { asSkillDir?: boolean; subdir?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.asSkillDir) form.append('asSkillDir', 'true');
    if (opts?.subdir) form.append('subdir', opts.subdir);
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/fs`,
      { method: 'POST', body: form },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) throw new Error(parsed.error);
      } catch (err) {
        if (err instanceof Error && err.message !== text) throw err;
      }
      throw new Error(text);
    }
    return res.json() as Promise<ProjectFsUploadResponse>;
  },

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
