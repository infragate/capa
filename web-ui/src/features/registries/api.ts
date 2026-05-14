import { api } from '../../lib/api';

export interface RegistryManifest {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  icon?: string;
  capabilities: string[];
}

export interface RegistriesResponse {
  registries: RegistryManifest[];
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

export const registriesApi = {
  list: () => api.get<RegistriesResponse>('/api/registries'),

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
