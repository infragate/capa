/**
 * Single EventSource per project page — capabilities + activity share one socket.
 */

type ProjectEventHandlers = {
  onOpen?: () => void;
  onError?: () => void;
  onCapabilitiesChanged?: () => void;
  onToolCall?: (ev: MessageEvent) => void;
};

type ProjectEventSubscription = {
  handlers: ProjectEventHandlers;
};

const subscriptions = new Map<string, Set<ProjectEventSubscription>>();
const sources = new Map<string, EventSource>();

function ensureSource(projectId: string): EventSource {
  const existing = sources.get(projectId);
  if (existing) return existing;

  const es = new EventSource(
    `/api/projects/${encodeURIComponent(projectId)}/events`,
  );

  es.onopen = () => {
    for (const sub of subscriptions.get(projectId) ?? []) {
      sub.handlers.onOpen?.();
    }
  };
  es.onerror = () => {
    for (const sub of subscriptions.get(projectId) ?? []) {
      sub.handlers.onError?.();
    }
  };

  const onCapabilities = () => {
    for (const sub of subscriptions.get(projectId) ?? []) {
      sub.handlers.onCapabilitiesChanged?.();
    }
  };
  const onToolCall = (ev: MessageEvent) => {
    for (const sub of subscriptions.get(projectId) ?? []) {
      sub.handlers.onToolCall?.(ev);
    }
  };

  es.addEventListener('capabilities-changed', onCapabilities);
  es.addEventListener('tool-call', onToolCall);
  sources.set(projectId, es);
  return es;
}

function teardownIfEmpty(projectId: string): void {
  const subs = subscriptions.get(projectId);
  if (subs && subs.size > 0) return;
  subscriptions.delete(projectId);
  const es = sources.get(projectId);
  if (!es) return;
  es.close();
  sources.delete(projectId);
}

/** Subscribe to the shared project SSE stream. Returns an unsubscribe fn. */
export function subscribeProjectEvents(
  projectId: string,
  handlers: ProjectEventHandlers,
): () => void {
  const sub: ProjectEventSubscription = { handlers };
  let set = subscriptions.get(projectId);
  if (!set) {
    set = new Set();
    subscriptions.set(projectId, set);
  }
  set.add(sub);
  ensureSource(projectId);

  return () => {
    set!.delete(sub);
    teardownIfEmpty(projectId);
  };
}
