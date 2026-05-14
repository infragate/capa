import { useQuery } from '@tanstack/react-query';
import { registriesApi } from './api';

export function useRegistries() {
  return useQuery({
    queryKey: ['registries'],
    queryFn: () => registriesApi.list(),
    select: (data) => data.registries,
    staleTime: 60_000,
  });
}

export function useRegistrySearch(
  registryId: string | undefined,
  capability: string | undefined,
  query: string,
) {
  return useQuery({
    queryKey: ['registry-search', registryId, capability, query],
    queryFn: () => registriesApi.search(registryId!, capability!, query || undefined, 20),
    enabled: !!registryId && !!capability,
    staleTime: 30_000,
  });
}

export function useRegistryView(
  registryId: string | undefined,
  capability: string | undefined,
  itemId: string | undefined,
) {
  return useQuery({
    queryKey: ['registry-view', registryId, capability, itemId],
    queryFn: () => registriesApi.view(registryId!, capability!, itemId!),
    enabled: !!registryId && !!capability && !!itemId,
    staleTime: 5 * 60_000,
  });
}
