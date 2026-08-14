import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openCredentialSetupTask } from '../open-credential-setup';
import type { InstallCtx } from '../context';

// Env vars that influence browser-launch gating (see cli/utils/environment).
const MANAGED_ENV = ['CI', 'CURSOR_AGENT', 'NO_BROWSER', 'BROWSER', 'DISPLAY', 'WAYLAND_DISPLAY'] as const;

function makeCtx(): InstallCtx {
  return {
    configureResult: {
      needsCredentials: true,
      credentialsUrl: 'http://127.0.0.1:5912/ui/project?id=demo',
      oauth2Servers: [{ serverId: 'atlassian', isConnected: false }],
      missingVariables: [],
    },
    warnings: [],
    errors: [],
  } as unknown as InstallCtx;
}

async function runTask(ctx: InstallCtx): Promise<{ output?: string }> {
  const def = openCredentialSetupTask();
  const taskHandle: { output?: string } = {};
  // The task signature is (ctx, task); only `task.output` is touched here.
  await def.task(ctx, taskHandle as never);
  return taskHandle;
}

describe('openCredentialSetupTask (browser gating)', () => {
  const saved: Record<string, string | undefined> = {};
  let savedPlatform: NodeJS.Platform;

  beforeEach(() => {
    savedPlatform = process.platform;
    for (const name of MANAGED_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    // Pretend we are on a graphical desktop so the only gating factor is the
    // sandbox/env signal each test sets explicitly.
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true });
    for (const name of MANAGED_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('does not launch a browser in a cloud agent sandbox and surfaces the URL', async () => {
    process.env.CURSOR_AGENT = '1';
    const ctx = makeCtx();
    const handle = await runTask(ctx);

    expect(handle.output).toBe('skipped browser open');
    expect(ctx.warnings.some((w) => w.includes('Skipping browser launch'))).toBe(true);
    expect(ctx.warnings.some((w) => w.includes('http://127.0.0.1:5912/ui/project?id=demo'))).toBe(true);
    // OAuth2 guidance is still recorded.
    expect(ctx.warnings.some((w) => w.includes('OAuth2 servers need connection: atlassian'))).toBe(true);
  });

  it('does not launch a browser when explicitly disabled via NO_BROWSER', async () => {
    process.env.NO_BROWSER = '1';
    const ctx = makeCtx();
    const handle = await runTask(ctx);

    expect(handle.output).toBe('skipped browser open');
    expect(ctx.warnings.some((w) => w.includes('Skipping browser launch'))).toBe(true);
  });
});
