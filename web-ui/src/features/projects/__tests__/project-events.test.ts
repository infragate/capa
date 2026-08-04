import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetProjectEventsForTests,
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
});
