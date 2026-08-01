import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import { projectsApi } from './api';
import type { CapabilitySection, ProjectDetail, ToolCallRecord } from '../../types/api';

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

    let es: EventSource | null = null;
    let disposed = false;

    const sync = () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['variables', projectId] });
      void qc.invalidateQueries({ queryKey: ['oauth2-servers', projectId] });
      void qc.invalidateQueries({ queryKey: ['server-tools', projectId] });
      void qc.invalidateQueries({ queryKey: ['skill-content', projectId] });
    };

    const connect = () => {
      if (disposed) return;
      es?.close();
      es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
      es.addEventListener('capabilities-changed', sync);
      // Refetch after every (re)connect — covers events missed while disconnected.
      es.onopen = () => {
        sync();
      };
    };

    connect();

    return () => {
      disposed = true;
      es?.removeEventListener('capabilities-changed', sync);
      es?.close();
      es = null;
    };
  }, [projectId, qc]);
}

function mergeToolCall(prev: ToolCallRecord[], next: ToolCallRecord): ToolCallRecord[] {
  const idx = prev.findIndex((c) => c.id === next.id);
  if (idx === -1) {
    return [next, ...prev].slice(0, 1000);
  }
  const copy = prev.slice();
  copy[idx] = next;
  return copy;
}

const ACTIVITY_PAGE_SIZE = 50;

/**
 * Recent tool-call activity + live SSE updates for the project page feed.
 * Retains at most 1000 traces server-side; UI pages with Load more.
 */
export function useProjectActivity(projectId: string | null) {
  const qc = useQueryClient();
  const [calls, setCalls] = useState<ToolCallRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [live, setLive] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const history = useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => projectsApi.getActivity(projectId!, { limit: ACTIVITY_PAGE_SIZE }),
    enabled: !!projectId,
  });

  const stats = useQuery({
    queryKey: ['activity-stats', projectId],
    queryFn: () => projectsApi.getActivityStats(projectId!),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!history.data) return;
    setCalls(history.data.calls);
    setHasMore(history.data.hasMore);
    setTotal(history.data.total);
  }, [history.data]);

  useEffect(() => {
    if (!projectId) return;

    let es: EventSource | null = null;
    let disposed = false;

    const onToolCall = (ev: MessageEvent) => {
      try {
        const record = JSON.parse(String(ev.data)) as ToolCallRecord;
        setCalls((prev) => mergeToolCall(prev, record));
        void qc.invalidateQueries({ queryKey: ['activity-stats', projectId] });
      } catch {
        // ignore malformed events
      }
    };

    const connect = () => {
      if (disposed) return;
      es?.close();
      es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
      es.addEventListener('tool-call', onToolCall);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
    };

    connect();

    return () => {
      disposed = true;
      setLive(false);
      es?.removeEventListener('tool-call', onToolCall);
      es?.close();
      es = null;
    };
  }, [projectId, qc]);

  const loadMore = useCallback(async () => {
    if (!projectId || loadingMore || !hasMore || calls.length === 0) return;
    const oldest = calls[calls.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const page = await projectsApi.getActivity(projectId, {
        limit: ACTIVITY_PAGE_SIZE,
        before: oldest.started_at,
        beforeId: oldest.id,
      });
      setCalls((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const appended = page.calls.filter((c) => !seen.has(c.id));
        return [...prev, ...appended].slice(0, 1000);
      });
      setHasMore(page.hasMore);
      setTotal(page.total);
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, loadingMore, hasMore, calls]);

  return {
    calls,
    stats: stats.data ?? null,
    isLoading: history.isLoading,
    error: history.error,
    live,
    hasMore,
    total,
    loadingMore,
    loadMore,
  };
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
    mutationFn: (serverId: string) => projectsApi.disconnectOAuth(projectId, serverId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oauth2-servers', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['server-tools', projectId] });
    },
  });
}

export function useStartOAuth(projectId: string) {
  return useMutation({
    mutationFn: (serverId: string) => projectsApi.startOAuth(projectId, serverId),
  });
}

export function useServerTools(projectId: string | null, serverId: string | null) {
  return useQuery({
    queryKey: ['server-tools', projectId, serverId],
    queryFn: () => projectsApi.getServerTools(projectId!, serverId!),
    enabled: !!projectId && !!serverId,
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
    onSuccess: () => invalidateProjectQueries(qc, projectId),
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
        if (section === 'skills') nextCaps.skills = reorderByIds(caps.skills, ids);
        else if (section === 'servers') nextCaps.servers = reorderByIds(caps.servers, ids);
        else if (section === 'tools') nextCaps.tools = reorderByIds(caps.tools, ids);
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
    onSettled: () => invalidateProjectQueries(qc, projectId),
  });
}

export function usePatchOptions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => projectsApi.patchOptions(projectId, patch),
    onSuccess: () => invalidateProjectQueries(qc, projectId),
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
