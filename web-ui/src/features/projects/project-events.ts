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

/** Test-only: drop shared sockets between cases. */
export function _resetProjectEventsForTests(): void {
  for (const es of sources.values()) {
    try {
      es.close();
    } catch {
      // ignore
    }
  }
  sources.clear();
  subscriptions.clear();
}

function capaAuthToken(): string | undefined {
  const g = globalThis as typeof globalThis & {
    window?: { __CAPA_AUTH_TOKEN__?: string };
    __CAPA_AUTH_TOKEN__?: string;
  };
  return g.window?.__CAPA_AUTH_TOKEN__ ?? g.__CAPA_AUTH_TOKEN__;
}

function ensureSource(projectId: string): EventSource {
  const existing = sources.get(projectId);
  if (existing && existing.readyState !== 2) return existing;
  if (existing) {
    existing.close();
    sources.delete(projectId);
  }

  const url = `/api/projects/${encodeURIComponent(projectId)}/events`;
  const token = capaAuthToken();
  const es = token
    ? createAuthedEventSource(url, token)
    : new EventSource(url);

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
  const es = ensureSource(projectId);

  // EventSource.onopen only fires on CONNECTING → OPEN. A late subscriber
  // (activity after capabilities sync) joining an already-open shared socket
  // would otherwise stay on "reconnecting…" forever.
  if (es.readyState === 1) {
    queueMicrotask(() => {
      if (!subscriptions.get(projectId)?.has(sub)) return;
      if (sources.get(projectId)?.readyState !== 1) return;
      sub.handlers.onOpen?.();
    });
  }

  return () => {
    set!.delete(sub);
    teardownIfEmpty(projectId);
  };
}

/** Overridable so tests can reconnect without wall-clock delays. */
export let sseReconnectDelaysMs = [250, 1000, 3000, 5000];

export function _setSseReconnectDelaysForTests(ms: number[]): void {
  sseReconnectDelaysMs = ms;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** EventSource cannot set Authorization; same-origin fetch can. */
function createAuthedEventSource(url: string, token: string): EventSource {
  const listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
  let userClosed = false;
  let attemptAbort = new AbortController();
  const es = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSED: 2,
    readyState: 0,
    url,
    withCredentials: false,
    onopen: null as ((ev: Event) => void) | null,
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn as (ev: MessageEvent) => void);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent;
      listeners.get(type)?.delete(fn as (ev: MessageEvent) => void);
    },
    dispatchEvent() {
      return false;
    },
    close() {
      userClosed = true;
      es.readyState = 2;
      attemptAbort.abort();
    },
  };

  const dispatchBlock = (block: string) => {
    let eventName = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    const ev = new MessageEvent(eventName, { data: data.join('\n') });
    if (eventName === 'message') es.onmessage?.(ev);
    for (const fn of listeners.get(eventName) ?? []) fn(ev);
  };

  void (async () => {
    let attempt = 0;
    while (!userClosed) {
      attemptAbort = new AbortController();
      es.readyState = 0;
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: attemptAbort.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`sse ${res.status}`);
        }
        es.readyState = 1;
        es.onopen?.(new Event('open'));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!userClosed && es.readyState === 1) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() ?? '';
          for (const block of blocks) dispatchBlock(block);
        }
      } catch {
        // fetch abort / network / non-OK
      }
      if (userClosed) return;
      es.readyState = 0;
      es.onerror?.(new Event('error'));
      const delay =
        sseReconnectDelaysMs[
          Math.min(attempt, sseReconnectDelaysMs.length - 1)
        ] ?? 5000;
      attempt += 1;
      try {
        await sleep(delay, attemptAbort.signal);
      } catch {
        return;
      }
    }
  })();

  return es as unknown as EventSource;
}
