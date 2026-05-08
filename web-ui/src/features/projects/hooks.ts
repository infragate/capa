import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from './api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    select: (data) => data.projects,
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });
}

export function useVariables(projectId: string | null) {
  return useQuery({
    queryKey: ['variables', projectId],
    queryFn: () => projectsApi.getVariables(projectId!),
    enabled: !!projectId,
    retry: false,
  });
}

export function useSaveVariables(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variables: Record<string, string>) =>
      projectsApi.saveVariables(projectId, variables),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variables', projectId] });
    },
  });
}

export function useOAuth2Servers(projectId: string | null) {
  return useQuery({
    queryKey: ['oauth2-servers', projectId],
    queryFn: () => projectsApi.getOAuth2Servers(projectId!),
    enabled: !!projectId,
    retry: false,
    select: (data) => data.servers,
  });
}

export function useDisconnectOAuth(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      projectsApi.disconnectOAuth(projectId, serverId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oauth2-servers', projectId] });
    },
  });
}

export function useServerTools(projectId: string | null, serverId: string | null) {
  return useQuery({
    queryKey: ['server-tools', projectId, serverId],
    queryFn: () => projectsApi.getServerTools(projectId!, serverId!),
    enabled: !!projectId && !!serverId,
    select: (data) => data.tools,
    staleTime: 60_000,
  });
}
