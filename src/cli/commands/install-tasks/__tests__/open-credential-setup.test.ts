import { describe, it, expect, afterEach } from 'bun:test';
import { setFlags } from '../../../ui';
import { openCredentialSetupTask } from '../open-credential-setup';
import type { InstallCtx } from '../context';

const CREDENTIALS_URL = 'http://127.0.0.1:5912/ui/project?id=demo';

function makeCtx(): InstallCtx {
  return {
    configureResult: {
      needsCredentials: true,
      credentialsUrl: CREDENTIALS_URL,
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

describe('openCredentialSetupTask (--headless gating)', () => {
  afterEach(() => {
    setFlags({ headless: false });
  });

  it('skips the browser and surfaces the URL when --headless is set', async () => {
    setFlags({ headless: true });
    const ctx = makeCtx();
    const handle = await runTask(ctx);

    expect(handle.output).toBe('skipped browser open');
    expect(ctx.warnings.some((w) => w.includes('Credentials needed — open'))).toBe(true);
    expect(ctx.warnings.some((w) => w.includes(CREDENTIALS_URL))).toBe(true);
    // OAuth2 guidance is still recorded.
    expect(ctx.warnings.some((w) => w.includes('OAuth2 servers need connection: atlassian'))).toBe(true);
  });

  it('respects the explicit skipOpen option regardless of --headless', async () => {
    setFlags({ headless: false });
    const def = openCredentialSetupTask({ skipOpen: true });
    const ctx = makeCtx();
    const handle: { output?: string } = {};
    await def.task(ctx, handle as never);

    expect(handle.output).toBe('skipped browser open');
    expect(ctx.warnings.some((w) => w.includes('Credentials needed — open'))).toBe(true);
  });
});
