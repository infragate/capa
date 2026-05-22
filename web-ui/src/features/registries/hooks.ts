import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  registriesApi,
  type RegistryAdminRecord,
  type RegistryManifest,
  type RegistrySourceType,
} from './api';

const REGISTRIES_KEY = ['registries'] as const;

export function useRegistriesAdmin() {
  return useQuery({
    queryKey: REGISTRIES_KEY,
    queryFn: () => registriesApi.list(),
    select: (data) => data.registries,
    staleTime: 30_000,
  });
}

/**
 * Browse-friendly view: only registries with a loaded manifest (status =
 * installed AND enabled). Surfaces them as RegistryManifest[] like the
 * existing browse page expects.
 */
export function useRegistries() {
  return useQuery({
    queryKey: REGISTRIES_KEY,
    queryFn: () => registriesApi.list(),
    select: (data): RegistryManifest[] =>
      data.registries
        .filter((r) => r.manifest && r.enabled && r.status === 'installed')
        .map((r) => r.manifest!),
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

export function useAddRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { slug?: string; type: RegistrySourceType; source: string }) =>
      registriesApi.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRIES_KEY });
    },
  });
}

export function useRemoveRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => registriesApi.remove(slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRIES_KEY });
    },
  });
}

export function useSetRegistryEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) =>
      registriesApi.patch(slug, { enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRIES_KEY });
    },
  });
}

export function useEditRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      type,
      source,
    }: {
      slug: string;
      type: RegistrySourceType;
      source: string;
    }) => registriesApi.patch(slug, { type, source }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRIES_KEY });
    },
  });
}

export function useRefreshRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => registriesApi.refresh(slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRIES_KEY });
    },
  });
}

export function usePreviewRegistry() {
  return useMutation({
    mutationFn: ({ type, source }: { type: RegistrySourceType; source: string }) =>
      registriesApi.preview(type, source),
  });
}

export type { RegistryAdminRecord };
