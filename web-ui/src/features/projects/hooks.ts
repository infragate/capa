import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { projectsApi } from './api';
import { subscribeProjectEvents } from './project-events';
import type {
  CapabilitySection,
  ProjectDetail,
  Server,
  Skill,
  Tool,
} from '../../types/api';
import { configuredToolReorderKey } from './components/tools/anchors';
import { reorderByKey, serverReorderKey, skillReorderKey } from './lib/reorderKeys';

function invalidateProjectQueries(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ['project', projectId] });
  qc.invalidateQueries({ queryKey: ['variables', projectId] });
  qc.invalidateQueries({ queryKey: ['oauth2-servers', projectId] });
  qc.invalidateQueries({ queryKey: ['server-tools', projectId] });
  qc.invalidateQueries({ queryKey: ['skill-content', projectId] });
}

function reorderByIds<T extends { id: string | null }>(items: T[], ids: string[]): T[] {
  const byId = new Map<string, T>();
  const rest: T[] = [];
  for (const item of items) {
    if (item.id) byId.set(item.id, item);
    else rest.push(item);
  }
  const next: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) {
      next.push(item);
      byId.delete(id);
    }
  }
  next.push(...byId.values(), ...rest);
  return next;
}

function reorderToolsByKey(tools: Tool[], keys: string[]): Tool[] {
  return reorderByKey(tools, keys, configuredToolReorderKey);
}

function reorderSkillsByKey(skills: Skill[], keys: string[]): Skill[] {
  return reorderByKey(skills, keys, skillReorderKey);
}

function reorderServersByKey(servers: Server[], keys: string[]): Server[] {
  return reorderByKey(servers, keys, serverReorderKey);
}

function shouldFetchServerTools(server: Server): boolean {
  return !!server.enabled && !(server.requiresOAuth && !server.isConnected);
}

function patchProjectServerEnabled(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  serverId: string,
  enabled: boolean,
): void {
  qc.setQueryData<ProjectDetail>(['project', projectId], (old) => {
    if (!old?.capabilities?.servers) return old;
    return {
      ...old,
      capabilities: {
        ...old.capabilities,
        servers: old.capabilities.servers.map((s) =>
          s.id === serverId ? { ...s, enabled } : s,
        ),
      },
    };
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    select: (data) => data.projects,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: (_data, projectId) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.removeQueries({ queryKey: ['project', projectId] });
      invalidateProjectQueries(qc, projectId);
    },
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });
}

/**
 * Keep the project page in sync when capabilities.yaml/json changes on disk
 * (manual edits or other processes). Server pushes via SSE.
 */
export function useProjectCapabilitiesLiveSync(projectId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;

    const sync = () => {
      invalidateProjectQueries(qc, projectId);
    };

    return subscribeProjectEvents(projectId, {
      onOpen: sync,
      onCapabilitiesChanged: sync,
    });
  }, [projectId, qc]);
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

export function usePutVariable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value?: string }) =>
      projectsApi.putVariable(projectId, name, value ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variables', projectId] });
    },
  });
}

export function useDeleteVariable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => projectsApi.deleteVariable(projectId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variables', projectId] });
    },
  });
}

export function useOAuth2Servers(projectId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['oauth2-servers', projectId],
    queryFn: () => projectsApi.getOAuth2Servers(projectId!),
    enabled: !!projectId,
    retry: false,
    select: (data) => data.servers,
  });

  useEffect(() => {
    if (!projectId || !query.isSuccess) return;
    void qc.invalidateQueries({ queryKey: ['project', projectId] });
  }, [projectId, qc, query.isSuccess, query.dataUpdatedAt]);

  return query;
}

export function useDisconnectOAuth(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => projectsApi.disconnectOAuth(projectId, serverId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oauth2-servers', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['server-tools', projectId] });
    },
  });
}

export function useSetServerEnabled(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, enabled }: { serverId: string; enabled: boolean }) => {
      const result = await projectsApi.setServerEnabled(projectId, serverId, enabled);
      patchProjectServerEnabled(qc, projectId, serverId, result.enabled);

      if (result.enabled && result.connected) {
        const project = qc.getQueryData<ProjectDetail>(['project', projectId]);
        const server = project?.capabilities?.servers.find((s) => s.id === serverId);
        if (server && shouldFetchServerTools(server)) {
          await qc.fetchQuery({
            queryKey: ['server-tools', projectId, serverId],
            queryFn: () => projectsApi.getServerTools(projectId, serverId),
          });
        }
      } else if (!result.enabled) {
        qc.removeQueries({ queryKey: ['server-tools', projectId, serverId] });
      }

      return result;
    },
  });
}

export function useStartOAuth(projectId: string) {
  return useMutation({
    mutationFn: (serverId: string) => projectsApi.startOAuth(projectId, serverId),
  });
}

export function useServerTools(
  projectId: string | null,
  serverId: string | null,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['server-tools', projectId, serverId],
    queryFn: () => projectsApi.getServerTools(projectId!, serverId!),
    enabled: (opts?.enabled ?? true) && !!projectId && !!serverId,
    select: (data) => data.tools,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSkillContent(projectId: string | null, skillId: string | null) {
  return useQuery({
    queryKey: ['skill-content', projectId, skillId],
    queryFn: () => projectsApi.getSkillContent(projectId!, skillId!),
    enabled: !!projectId && !!skillId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAppendCapability(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      section,
      entry,
    }: {
      section: CapabilitySection;
      entry: Record<string, unknown>;
    }) => projectsApi.appendCapability(projectId, section, entry),
    onMutate: async ({ section, entry }) => {
      if (section !== 'tools') return undefined;
      await qc.cancelQueries({ queryKey: ['project', projectId] });
      const previous = qc.getQueryData<ProjectDetail>(['project', projectId]);
      const id = typeof entry.id === 'string' ? entry.id : null;
      if (!id || !previous?.capabilities) return { previous };

      const def =
        entry.def && typeof entry.def === 'object' && !Array.isArray(entry.def)
          ? (entry.def as Record<string, unknown>)
          : {};
      const optimistic = {
        id,
        type: (entry.type === 'command' ? 'command' : 'mcp') as 'mcp' | 'command',
        description: typeof entry.description === 'string' ? entry.description : null,
        sourcePlugin: null,
        mcpServer: typeof def.server === 'string' ? def.server : undefined,
        mcpTool: typeof def.tool === 'string' ? def.tool : undefined,
        defaults:
          def.defaults && typeof def.defaults === 'object'
            ? (def.defaults as Record<string, unknown>)
            : null,
        formatter:
          def.formatter &&
          typeof def.formatter === 'object' &&
          typeof (def.formatter as { cmd?: unknown }).cmd === 'string'
            ? (def.formatter as { cmd: string; timeout?: number })
            : null,
        command:
          def.run && typeof def.run === 'object' && !Array.isArray(def.run)
            ? typeof (def.run as Record<string, unknown>).cmd === 'string'
              ? ((def.run as Record<string, unknown>).cmd as string)
              : undefined
            : typeof entry.command === 'string'
              ? entry.command
              : undefined,
        group: typeof entry.group === 'string' ? entry.group : undefined,
      };

      qc.setQueryData<ProjectDetail>(['project', projectId], {
        ...previous,
        capabilities: {
          ...previous.capabilities,
          tools: [...previous.capabilities.tools, optimistic],
        },
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(['project', projectId], ctx.previous);
      }
    },
    onSettled: () => invalidateProjectQueries(qc, projectId),
  });
}

export function useUpdateCapability(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      section,
      entryId,
      patch,
    }: {
      section: CapabilitySection;
      entryId: string;
      patch: Record<string, unknown>;
    }) => projectsApi.updateCapability(projectId, section, entryId, patch),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
  });
}

export function useDeleteCapability(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      section,
      entryId,
      cascadeTools,
    }: {
      section: CapabilitySection;
      entryId: string;
      cascadeTools?: boolean;
    }) => projectsApi.deleteCapability(projectId, section, entryId, { cascadeTools }),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
  });
}

export function useReorderCapability(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ section, ids }: { section: CapabilitySection; ids: string[] }) =>
      projectsApi.reorderCapability(projectId, section, ids),
    onMutate: async ({ section, ids }) => {
      await qc.cancelQueries({ queryKey: ['project', projectId] });
      const previous = qc.getQueryData<ProjectDetail>(['project', projectId]);
      qc.setQueryData<ProjectDetail>(['project', projectId], (old) => {
        if (!old?.capabilities) return old;
        const caps = old.capabilities;
        const nextCaps = { ...caps };
        if (section === 'skills') nextCaps.skills = reorderSkillsByKey(caps.skills, ids);
        else if (section === 'servers') nextCaps.servers = reorderServersByKey(caps.servers, ids);
        else if (section === 'tools') nextCaps.tools = reorderToolsByKey(caps.tools, ids);
        else if (section === 'plugins' && caps.plugins) {
          nextCaps.plugins = reorderByIds(caps.plugins, ids);
        } else if (section === 'subagents') {
          nextCaps.subagents = reorderByIds(caps.subagents, ids);
        } else if (section === 'rules') nextCaps.rules = reorderByIds(caps.rules, ids);
        else if (section === 'hooks') nextCaps.hooks = reorderByIds(caps.hooks, ids);
        return { ...old, capabilities: nextCaps };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(['project', projectId], ctx.previous);
      }
    },
    // Reorder does not change servers/tool schemas — only refresh the project doc
    // to avoid stampedes of /servers/*/tools while the optimistic order is correct.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}

export function usePatchOptions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => projectsApi.patchOptions(projectId, patch),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
  });
}

export function useSyncActivityHooks(projectId: string) {
  return useMutation({
    mutationFn: () => projectsApi.syncActivityHooks(projectId),
  });
}

export function usePutAgents(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agents: import('../../types/api').AgentFileConfig | Record<string, unknown> | null) =>
      projectsApi.putAgents(projectId, agents),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
  });
}

export function useAddFromRegistry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      section,
      registry,
      itemId,
      capability,
    }: {
      section: 'skills' | 'plugins';
      registry: string;
      itemId: string;
      capability?: 'skills' | 'plugins';
    }) => projectsApi.addFromRegistry(projectId, section, { registry, itemId, capability }),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
  });
}
