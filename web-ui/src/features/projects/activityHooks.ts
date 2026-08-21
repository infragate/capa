import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectsApi } from './api';
import { subscribeProjectEvents } from './project-events';
import type { ToolCallRecord } from '../../types/api';
import { reconcileCursorActivityConversationIds } from '../../../../src/shared/activity-correlation-reconcile';

const ACTIVITY_PAGE_SIZE = 50;
const ACTIVITY_SESSION_PAGE_SIZE = 100;
const ACTIVITY_RETENTION = 10_000;
/** Coalesce busy-agent stats invalidations. */
const STATS_INVALIDATE_MS = 2_000;

function mergeToolCall(prev: ToolCallRecord[], next: ToolCallRecord): ToolCallRecord[] {
  const idx = prev.findIndex((c) => c.id === next.id);
  if (idx === -1) {
    return [next, ...prev].slice(0, ACTIVITY_RETENTION);
  }
  const copy = prev.slice();
  copy[idx] = next;
  return copy;
}

function mergeHistorySeed(
  prev: ToolCallRecord[],
  pageCalls: ToolCallRecord[],
): ToolCallRecord[] {
  if (prev.length === 0) return pageCalls;
  const byId = new Map<string, ToolCallRecord>();
  // Prefer live/updated rows already in state; seed fills gaps from page 1.
  for (const c of pageCalls) byId.set(c.id, c);
  for (const c of prev) byId.set(c.id, c);
  return [...byId.values()]
    .sort((a, b) => {
      if (b.started_at !== a.started_at) return b.started_at - a.started_at;
      return b.id.localeCompare(a.id);
    })
    .slice(0, ACTIVITY_RETENTION);
}

/**
 * Recent tool-call activity + live SSE updates for the project page feed.
 * Retains at most 10k traces server-side; UI pages with Load more.
 */
export function useProjectActivity(projectId: string | null) {
  const qc = useQueryClient();
  const [calls, setCalls] = useState<ToolCallRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [live, setLive] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seededForData = useRef<unknown>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    seededForData.current = null;
    setCalls([]);
    setHasMore(false);
    setTotal(0);
  }, [projectId]);

  useEffect(() => {
    if (!history.data) return;
    // Seed page-1 once per fetch result; never wipe live/loadMore merges on refetch.
    if (seededForData.current === history.data) return;
    seededForData.current = history.data;
    const page = history.data;
    setCalls((prev) => {
      const wasPaginated = prev.length > page.calls.length;
      const merged = mergeHistorySeed(prev, page.calls);
      if (!wasPaginated) {
        setHasMore(page.hasMore);
      }
      setTotal(page.total);
      return merged;
    });
  }, [history.data]);

  useEffect(() => {
    if (!projectId) return;

    const scheduleStatsInvalidate = () => {
      if (statsTimer.current) return;
      statsTimer.current = setTimeout(() => {
        statsTimer.current = null;
        void qc.invalidateQueries({ queryKey: ['activity-stats', projectId] });
      }, STATS_INVALIDATE_MS);
    };

    const onToolCall = (ev: MessageEvent) => {
      try {
        const record = JSON.parse(String(ev.data)) as ToolCallRecord;
        setCalls((prev) => mergeToolCall(prev, record));
        scheduleStatsInvalidate();
      } catch {
        // ignore malformed events
      }
    };

    const unsub = subscribeProjectEvents(projectId, {
      onOpen: () => {
        setLive(true);
        // Recover rows missed while disconnected without wiping loadMore.
        void qc.invalidateQueries({ queryKey: ['activity', projectId] });
      },
      onError: () => setLive(false),
      onToolCall,
    });

    return () => {
      unsub();
      setLive(false);
      if (statsTimer.current) {
        clearTimeout(statsTimer.current);
        statsTimer.current = null;
      }
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
        return [...prev, ...appended].slice(0, ACTIVITY_RETENTION);
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

export function useProjectActivitySession(
  projectId: string | null,
  sessionId: string | null,
) {
  return useQuery({
    queryKey: ['activity-session', projectId, sessionId],
    queryFn: async () => {
      const all: ToolCallRecord[] = [];
      let before: number | undefined;
      let beforeId: string | undefined;
      for (;;) {
        const page = await projectsApi.getActivity(projectId!, {
          limit: ACTIVITY_SESSION_PAGE_SIZE,
          sessionId: sessionId!,
          before,
          beforeId,
        });
        all.push(...page.calls);
        if (!page.hasMore || page.calls.length === 0) break;
        const oldest = page.calls[page.calls.length - 1]!;
        before = oldest.started_at;
        beforeId = oldest.id;
      }
      return all;
    },
    enabled: !!projectId && !!sessionId,
    staleTime: 30_000,
  });
}

export function useProjectActivityGeneration(
  projectId: string | null,
  generationId: string | null,
  opts?: {
    /** Live feed rows to merge (covers rows not yet fetched + SSE overlap). */
    feedCalls?: ToolCallRecord[];
    /** When false, skips fetch/subscribe (dialog closed). */
    enabled?: boolean;
  },
) {
  const enabled =
    opts?.enabled ?? (!!projectId && !!generationId);
  const feedCalls = opts?.feedCalls;
  const [mergedCalls, setMergedCalls] = useState<ToolCallRecord[]>([]);

  const query = useQuery({
    queryKey: ['activity-generation', projectId, generationId],
    queryFn: () =>
      projectsApi.getActivity(projectId!, { generationId: generationId! }),
    enabled: enabled && !!projectId && !!generationId,
    select: (data) => data.calls,
    staleTime: 30_000,
  });

  const mergeGenerationCalls = useCallback(
    (sources: ToolCallRecord[][]) => {
      if (!generationId) return [];
      const byId = new Map<string, ToolCallRecord>();
      for (const source of sources) {
        for (const call of source) {
          if (call.generation_id === generationId) {
            byId.set(call.id, call);
          }
        }
      }
      return [...byId.values()].sort(
        (a, b) => a.started_at - b.started_at || a.id.localeCompare(b.id),
      );
    },
    [generationId],
  );

  useEffect(() => {
    if (!enabled) {
      setMergedCalls([]);
      return;
    }
    setMergedCalls(
      mergeGenerationCalls([
        query.data ?? [],
        feedCalls ?? [],
      ]),
    );
  }, [enabled, query.data, feedCalls, mergeGenerationCalls]);

  useEffect(() => {
    if (!enabled || !projectId || !generationId) return;

    const onToolCall = (ev: MessageEvent) => {
      try {
        const record = JSON.parse(String(ev.data)) as ToolCallRecord;
        if (record.generation_id !== generationId) return;
        setMergedCalls((prev) => {
          const idx = prev.findIndex((c) => c.id === record.id);
          const next =
            idx === -1
              ? [...prev, record]
              : prev.map((c, i) => (i === idx ? record : c));
          return mergeGenerationCalls([next]);
        });
      } catch {
        // ignore malformed events
      }
    };

    return subscribeProjectEvents(projectId, { onToolCall });
  }, [enabled, projectId, generationId, mergeGenerationCalls]);

  return {
    ...query,
    data: mergedCalls,
  };
}

export function useProjectActivityConversation(
  projectId: string | null,
  conversationId: string | null,
  opts?: {
    /** Live feed rows to merge (covers rows not yet fetched + SSE overlap). */
    feedCalls?: ToolCallRecord[];
    /** When false, skips fetch/subscribe (dialog closed). */
    enabled?: boolean;
  },
) {
  const enabled =
    opts?.enabled ?? (!!projectId && !!conversationId);
  const feedCalls = opts?.feedCalls;
  const [mergedCalls, setMergedCalls] = useState<ToolCallRecord[]>([]);

  const query = useQuery({
    queryKey: ['activity-conversation', projectId, conversationId],
    queryFn: () =>
      projectsApi.getActivity(projectId!, { conversationId: conversationId! }),
    enabled: enabled && !!projectId && !!conversationId,
    select: (data) => data.calls,
    staleTime: 30_000,
  });

  const mergeConversationCalls = useCallback(
    (sources: ToolCallRecord[][]) => {
      if (!conversationId) return [];
      const byId = new Map<string, ToolCallRecord>();
      for (const source of sources) {
        for (const call of source) byId.set(call.id, call);
      }
      const reconciled = reconcileCursorActivityConversationIds([...byId.values()]);
      return reconciled.filter((c) => c.conversation_id === conversationId);
    },
    [conversationId],
  );

  useEffect(() => {
    if (!enabled) {
      setMergedCalls([]);
      return;
    }
    setMergedCalls(
      mergeConversationCalls([
        query.data ?? [],
        feedCalls ?? [],
      ]),
    );
  }, [enabled, query.data, feedCalls, mergeConversationCalls]);

  useEffect(() => {
    if (!enabled || !projectId || !conversationId) return;

    const onToolCall = (ev: MessageEvent) => {
      try {
        const record = JSON.parse(String(ev.data)) as ToolCallRecord;
        setMergedCalls((prev) => {
          const idx = prev.findIndex((c) => c.id === record.id);
          const next =
            idx === -1
              ? [record, ...prev]
              : prev.map((c, i) => (i === idx ? record : c));
          return mergeConversationCalls([next]);
        });
      } catch {
        // ignore malformed events
      }
    };

    return subscribeProjectEvents(projectId, { onToolCall });
  }, [enabled, projectId, conversationId, mergeConversationCalls]);

  return {
    ...query,
    data: mergedCalls,
  };
}

