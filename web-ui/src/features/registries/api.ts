import { api } from '../../lib/api';

export interface RegistryManifest {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  icon?: string;
  capabilities: string[];
}

export type RegistrySourceType = 'github' | 'gitlab' | 'url';
export type RegistryStatus = 'pending' | 'installed' | 'failed' | 'disabled';

export interface RegistryAdminRecord {
  slug: string;
  type: RegistrySourceType;
  source: string;
  enabled: boolean;
  status: RegistryStatus;
  lastError: string | null;
  resolvedRef: string | null;
  installedAt: number | null;
  createdAt: number;
  updatedAt: number;
  manifest: RegistryManifest | null;
}

export interface RegistriesResponse {
  registries: RegistryAdminRecord[];
}

export interface RegistryItemSummary {
  id: string;
  capability: string;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  icon?: string;
  tags?: string[];
  homepage?: string;
  updatedAt?: string;
  installSnippet?: Record<string, unknown>;
}

export interface RegistrySearchResult {
  items: RegistryItemSummary[];
  nextCursor?: string;
  total?: number;
}

export interface RegistryItemDetail extends RegistryItemSummary {
  preview: string;
  installSnippet: Record<string, unknown>;
  readme?: string;
  examples?: string[];
  files?: string[];
}

export interface RegistryPreviewResponse {
  content: string;
  resolvedRef: string | null;
  derivedSlug: string | null;
}

export interface RegistryMutationResponse {
  registry: RegistryAdminRecord;
  manifest?: RegistryManifest | null;
}

export const registriesApi = {
  list: () => api.get<RegistriesResponse>('/api/registries'),

  create: (input: { slug?: string; type: RegistrySourceType; source: string }) =>
    api.post<RegistryMutationResponse>('/api/registries', input),

  remove: (slug: string) => api.delete<void>(`/api/registries/${encodeURIComponent(slug)}`),

  patch: (
    slug: string,
    body: { enabled?: boolean; type?: RegistrySourceType; source?: string },
  ) =>
    api.patch<RegistryMutationResponse>(`/api/registries/${encodeURIComponent(slug)}`, body),

  refresh: (slug: string) =>
    api.post<RegistryMutationResponse>(`/api/registries/${encodeURIComponent(slug)}/refresh`),

  preview: (type: RegistrySourceType, source: string) => {
    const params = new URLSearchParams({ type, source });
    return api.get<RegistryPreviewResponse>(`/api/registries/preview?${params}`);
  },

  search: (
    registryId: string,
    capability: string,
    query?: string,
    limit?: number,
    cursor?: string,
  ) => {
    const params = new URLSearchParams({ capability });
    if (query) params.set('q', query);
    if (limit != null) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    return api.get<RegistrySearchResult>(
      `/api/registries/${encodeURIComponent(registryId)}/search?${params}`,
    );
  },

  view: (registryId: string, capability: string, itemId: string) =>
    api.get<RegistryItemDetail>(
      `/api/registries/${encodeURIComponent(registryId)}/view/${encodeURIComponent(itemId)}?capability=${encodeURIComponent(capability)}`,
    ),
};
