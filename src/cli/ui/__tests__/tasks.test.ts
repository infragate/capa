import { describe, it, expect, afterEach } from 'bun:test';
import { setFlags } from '../flags';
import { warn, info } from '../output';
import { runTasks } from '../tasks';

const ERASE_SPINNER_LINES = '\x1b[2A\x1b[J';
const AUTH_URL = 'https://example.com/oauth/authorize?code=demo';

function setIsTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    enumerable: true,
    value,
  });
  return () => {
    if (original) {
      Object.defineProperty(stream, 'isTTY', original);
    } else {
      delete (stream as { isTTY?: boolean }).isTTY;
    }
  };
}

async function captureStdio(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origError = console.error;

  const take = (chunk: unknown) => {
    if (typeof chunk === 'string') chunks.push(chunk);
    else if (Buffer.isBuffer(chunk)) chunks.push(chunk.toString('utf8'));
  };

  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    take(chunk);
    return (origStdout as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    take(chunk);
    return (origStderr as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stderr.write;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };

  try {
    await fn();
    return chunks.join('');
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origError;
  }
}

describe('runTasks (--headless)', () => {
  const previousCI = process.env.CI;
  const restore: Array<() => void> = [];

  afterEach(() => {
    while (restore.length) restore.pop()?.();
    setFlags({ headless: false, json: false, quiet: false, verbose: false });
    if (previousCI === undefined) delete process.env.CI;
    else process.env.CI = previousCI;
  });

  it('keeps warn/info lines from tasks instead of erasing them as spinner output', async () => {
    restore.push(setIsTTY(process.stdin, true), setIsTTY(process.stdout, true));
    delete process.env.CI;
    setFlags({ headless: true });

    const output = await captureStdio(async () => {
      await runTasks([
        {
          title: 'Open browser for authentication',
          task: async () => {
            warn('Please open this URL in your browser to authenticate:');
            info(`   ${AUTH_URL}`);
          },
        },
        {
          title: 'Waiting for browser authorization...',
          task: async () => {},
        },
      ]);
    });

    expect(output).toContain(AUTH_URL);
    expect(output).not.toContain(ERASE_SPINNER_LINES);
  });
});
