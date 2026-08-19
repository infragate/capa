import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetProjectEventsForTests,
  _setSseReconnectDelaysForTests,
  subscribeProjectEvents,
} from '../project-events';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev?: Event) => void) | null = null;
  onerror: ((ev?: Event) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
}

describe('subscribeProjectEvents', () => {
  const OriginalEventSource = globalThis.EventSource;

  afterEach(() => {
    _resetProjectEventsForTests();
    FakeEventSource.instances = [];
    globalThis.EventSource = OriginalEventSource;
    _setSseReconnectDelaysForTests([250, 1000, 3000, 5000]);
    const g = globalThis as { window?: { __CAPA_AUTH_TOKEN__?: string } };
    if (g.window) delete g.window.__CAPA_AUTH_TOKEN__;
  });

  it('notifies late subscribers when the shared socket is already open', async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

    const opens: string[] = [];
    const unsub1 = subscribeProjectEvents('proj-1', {
      onOpen: () => opens.push('first'),
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0]!.open();
    expect(opens).toEqual(['first']);

    const unsub2 = subscribeProjectEvents('proj-1', {
      onOpen: () => opens.push('late'),
    });
    // Still one shared socket
    expect(FakeEventSource.instances).toHaveLength(1);

    await Promise.resolve(); // queueMicrotask
    expect(opens).toEqual(['first', 'late']);

    unsub1();
    unsub2();
  });

  it('does not notify late subscriber after immediate unsubscribe', async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

    subscribeProjectEvents('proj-1', { onOpen: () => {} });
    FakeEventSource.instances[0]!.open();

    let called = false;
    const unsub = subscribeProjectEvents('proj-1', {
      onOpen: () => {
        called = true;
      },
    });
    unsub();
    await Promise.resolve();
    expect(called).toBe(false);
  });

  it('retries authenticated SSE after a dropped fetch', async () => {
    _setSseReconnectDelaysForTests([15, 15, 15]);
    const g = globalThis as { window?: { __CAPA_AUTH_TOKEN__?: string } };
    g.window = { ...(g.window ?? {}), __CAPA_AUTH_TOKEN__: 'tok' };
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      if (fetches === 1) {
        return new Response(null, { status: 500 });
      }
      return new Response('event: ping\ndata: ok\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const unsub = subscribeProjectEvents('proj-auth', {});
    await Bun.sleep(30);
    unsub();
    globalThis.fetch = originalFetch;
    expect(fetches).toBeGreaterThanOrEqual(2);
  });
});
