import * as readline from 'readline';

/**
 * Block until the user interrupts the wrap watcher, or `signal` aborts
 * (e.g. GUI window closed).
 *
 * On Windows (especially Bun-compiled exes), `process.on('SIGINT')` alone is
 * unreliable. We also listen via readline's SIGINT and a simple `q`+Enter.
 */
export function waitForInterrupt(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let rl: readline.Interface | null = null;

    const done = () => {
      if (settled) return;
      settled = true;
      try {
        process.off('SIGINT', done);
        process.off('SIGTERM', done);
        process.off('SIGHUP', done);
      } catch {
        // SIGHUP may not exist on Windows
      }
      try {
        signal?.removeEventListener('abort', done);
      } catch {
        // ignore
      }
      if (rl) {
        try {
          rl.removeListener('SIGINT', done);
          rl.removeListener('line', onLine);
          rl.close();
        } catch {
          // ignore
        }
        rl = null;
      }
      resolve();
    };

    const onLine = (line: string) => {
      const t = line.trim().toLowerCase();
      if (t === 'q' || t === 'quit' || t === 'exit') done();
    };

    if (signal?.aborted) {
      done();
      return;
    }

    process.on('SIGINT', done);
    process.on('SIGTERM', done);
    try {
      process.on('SIGHUP', done);
    } catch {
      // Windows
    }
    signal?.addEventListener('abort', done, { once: true });

    if (process.stdin.isTTY) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      // readline fires SIGINT on Ctrl+C more reliably on Windows than process alone
      rl.on('SIGINT', done);
      rl.on('line', onLine);
    }
  });
}
