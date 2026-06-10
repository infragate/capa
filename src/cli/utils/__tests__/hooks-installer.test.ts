import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { installHooks, pruneOrphanHooks, cleanHooks } from '../hooks-installer';
import { LockfileBuilder } from '../../../shared/lockfile';
import type { Hook } from '../../../types/hooks';
import type { AuthenticatedFetch } from '../../../shared/authenticated-fetch';
import type { GetSnapshotResult } from '../../../shared/cache';

function makeAuthFetch(): AuthenticatedFetch {
  return {
    fetch: async () => new Response('echo from-remote\n', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    hasAuth: () => false,
  } as unknown as AuthenticatedFetch;
}

const stubGetRepoSnapshot = async (): Promise<GetSnapshotResult> => {
  throw new Error('repo snapshot fetcher should not be invoked in inline-only tests');
};

describe('hooks-installer (claude inline-config)', () => {
  let tempDir: string;
  let projectPath: string;
  let db: CapaDatabase;
  let dbPath: string;
  const projectId = 'test-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-hooks-installer-'));
    projectPath = join(tempDir, 'project');
    require('fs').mkdirSync(projectPath, { recursive: true });
    dbPath = join(tempDir, 'capa.db');
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: projectId, path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a claude entry into .claude/settings.json and records it in managed_hooks', async () => {
    const hooks: Hook[] = [
      {
        id: 'audit-bash',
        on: 'beforeShell',
        type: 'command',
        command: 'echo running',
      },
    ];

    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks,
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(1);
    expect(result.warnings).toEqual([]);

    const settingsPath = join(projectPath, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, any>;
    const events = config.hooks.PreToolUse;
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].matcher).toBe('Bash');
    expect(events[0].hooks[0].command).toBe('echo running');
    expect(events[0].hooks[0].name).toBe('capa:audit-bash');

    const rows = db.getManagedHooks(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe('claude-code');
    expect(rows[0].hookId).toBe('audit-bash');
    expect(JSON.parse(rows[0].locator)).toEqual(['PreToolUse', 0, 'hooks', 0]);
  });

  it('preserves user-authored entries when capa upserts its own', async () => {
    const settingsPath = join(projectPath, '.claude', 'settings.json');
    require('fs').mkdirSync(join(projectPath, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: 'user-script' }] },
            ],
          },
          permissions: ['*'],
        },
        null,
        2,
      ),
    );

    await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [{ id: 'capa-bash', on: 'beforeShell', command: 'echo capa' }],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });

    const config = JSON.parse(readFileSync(settingsPath, 'utf-8')) as any;
    expect(config.permissions).toEqual(['*']);
    const bashEvents = config.hooks.PreToolUse[0].hooks;
    expect(bashEvents).toHaveLength(2);
    const commands = bashEvents.map((h: any) => h.command);
    expect(commands).toContain('user-script');
    expect(commands).toContain('echo capa');
  });

  it('warns and skips when a provider has no hook integration', async () => {
    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [{ id: 'whatever', on: 'sessionStart', command: 'echo' }],
      providers: ['amp'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(0);
    expect(result.warnings.some((w) => w.includes('does not support project-level hooks'))).toBe(true);
  });

  it('warns when canonical event has no mapping for provider', async () => {
    // Codex's hook surface has no `beforeFileRead` equivalent (it routes
    // file ops through PostToolUse + apply_patch instead), so it's a
    // stable choice for "canonical event with no mapping for provider".
    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [{ id: 'br', on: 'beforeFileRead', command: 'echo read' }],
      providers: ['codex'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(0);
    expect(result.warnings.some((w) => /no mapping/.test(w))).toBe(true);
  });

  it('source.type=local inside the project is referenced by a portable relative path', async () => {
    // Place a script inside the project and point the hook at it. Because the
    // script lives in the repo, capa must embed a PROJECT-RELATIVE path in the
    // provider config (not the author's absolute, machine-specific path) so the
    // committed config works for everyone who clones the repo.
    require('fs').mkdirSync(join(projectPath, 'scripts'), { recursive: true });
    const scriptPath = join(projectPath, 'scripts', 'lint.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho lint\n', 'utf-8');

    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [
        {
          id: 'lint-after-edit',
          on: 'afterFileEdit',
          source: { type: 'local', path: 'scripts/lint.sh' },
        },
      ],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(1);

    const settings = JSON.parse(
      readFileSync(join(projectPath, '.claude', 'settings.json'), 'utf-8'),
    ) as any;
    const entry = settings.hooks.PostToolUse[0].hooks[0];
    // Relative, forward-slashed, ./-prefixed — and crucially NOT absolute.
    expect(entry.command).toBe('./scripts/lint.sh');
    expect(entry.command).not.toContain(projectPath);

    // No copy in ~/.capa — managed_hooks.scriptPath stays null so clean
    // never tries to unlink the user's file.
    const rows = db.getManagedHooks(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].scriptPath).toBeNull();
  });

  it('source.type=local outside the project keeps the absolute path', async () => {
    // A script that lives outside the project can't be committed, so a relative
    // path would be meaningless — capa keeps the absolute path in that case.
    const outsideDir = join(tempDir, 'outside');
    require('fs').mkdirSync(outsideDir, { recursive: true });
    const scriptPath = join(outsideDir, 'global-hook.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho hi\n', 'utf-8');

    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [
        {
          id: 'global-edit',
          on: 'afterFileEdit',
          source: { type: 'local', path: '../outside/global-hook.sh' },
        },
      ],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(1);

    const settings = JSON.parse(
      readFileSync(join(projectPath, '.claude', 'settings.json'), 'utf-8'),
    ) as any;
    const entry = settings.hooks.PostToolUse[0].hooks[0];
    expect(entry.command).toBe(scriptPath);
  });

  it('prompt-type local source reads the file contents as the prompt text', async () => {
    // For a command hook, `source.type=local` references the script in
    // place. For a PROMPT hook there's no script to execute — the file *is*
    // the prompt text, so capa must read it inline (like inline/remote
    // sources) instead of leaving the run reference empty and skipping it.
    require('fs').mkdirSync(join(projectPath, 'prompts'), { recursive: true });
    const promptPath = join(projectPath, 'prompts', 'guard.txt');
    writeFileSync(promptPath, 'Only allow read-only commands.\n', 'utf-8');

    const result = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [
        {
          id: 'shell-guard',
          on: 'beforeShell',
          type: 'prompt',
          source: { type: 'local', path: 'prompts/guard.txt' },
        },
      ],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(result.installed).toBe(1);
    expect(result.warnings).toEqual([]);

    const settings = JSON.parse(
      readFileSync(join(projectPath, '.claude', 'settings.json'), 'utf-8'),
    ) as any;
    const entry = settings.hooks.PreToolUse[0].hooks[0];
    expect(entry.type).toBe('prompt');
    expect(entry.prompt).toBe('Only allow read-only commands.\n');

    // The prompt is inlined into the provider config; nothing is
    // materialised under ~/.capa, so scriptPath stays null.
    const rows = db.getManagedHooks(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].scriptPath).toBeNull();
  });

  it('records remote sources in the lockfile builder', async () => {
    const lockBuilder = new LockfileBuilder(null);
    await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [
        {
          id: 'remote-hook',
          on: 'beforeShell',
          source: { type: 'remote', url: 'https://example.com/hook.sh' },
        },
      ],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
      lockBuilder,
    });

    const lock = lockBuilder.build();
    expect(lock.hooks).toHaveLength(1);
    expect(lock.hooks[0].id).toBe('remote-hook');
    expect(lock.hooks[0].source).toBe('remote');
    expect(lock.hooks[0].url).toBe('https://example.com/hook.sh');
    expect(lock.hooks[0].bodySha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('hooks-installer (cursor standalone)', () => {
  let tempDir: string;
  let projectPath: string;
  let db: CapaDatabase;
  const projectId = 'test-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-hooks-installer-cur-'));
    projectPath = join(tempDir, 'project');
    require('fs').mkdirSync(projectPath, { recursive: true });
    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: projectId, path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a cursor envelope and replaces capa-tagged entries on re-install', async () => {
    const installOnce = (command: string) =>
      installHooks({
        projectPath,
        projectId,
        capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
        hooks: [{ id: 'shell-audit', on: 'beforeShell', command }],
        providers: ['cursor'],
        db,
        authFetch: makeAuthFetch(),
        getRepoSnapshot: stubGetRepoSnapshot,
      });

    await installOnce('echo first');
    await installOnce('echo second');

    const path = join(projectPath, '.cursor', 'hooks.json');
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf-8')) as any;
    expect(config.version).toBe(1);
    expect(config.hooks.beforeShellExecution).toHaveLength(1);
    expect(config.hooks.beforeShellExecution[0].command).toBe('echo second');

    const rows = db.getManagedHooks(projectId);
    expect(rows).toHaveLength(1);
  });
});

describe('hooks-installer — pruneOrphanHooks / cleanHooks', () => {
  let tempDir: string;
  let projectPath: string;
  let db: CapaDatabase;
  const projectId = 'test-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-hooks-prune-'));
    projectPath = join(tempDir, 'project');
    require('fs').mkdirSync(projectPath, { recursive: true });
    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: projectId, path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('drops entries no longer requested but keeps current ones', async () => {
    await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [
        { id: 'a', on: 'beforeShell', command: 'echo a' },
        { id: 'b', on: 'beforeShell', command: 'echo b' },
      ],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(db.getManagedHooks(projectId)).toHaveLength(2);

    const result = pruneOrphanHooks(
      projectPath,
      projectId,
      [{ id: 'a', on: 'beforeShell', command: 'echo a' }],
      ['claude-code'],
      db,
    );
    expect(result.removed).toBe(1);
    const remaining = db.getManagedHooks(projectId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].hookId).toBe('a');

    const settings = JSON.parse(
      readFileSync(join(projectPath, '.claude', 'settings.json'), 'utf-8'),
    ) as any;
    const bashHooks = settings.hooks.PreToolUse[0].hooks;
    expect(bashHooks).toHaveLength(1);
    expect(bashHooks[0].command).toBe('echo a');
  });

  it('keeps the managed_hooks row when on-disk prune fails so future runs can retry', async () => {
    // Install a hook, then corrupt the locator so removeManagedHookEntry
    // throws. The DB row should survive the failed prune (warn-but-retry)
    // instead of leaving an orphan entry in the provider config forever.
    await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [{ id: 'orphan', on: 'beforeShell', command: 'echo orphan' }],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });
    expect(db.getManagedHooks(projectId)).toHaveLength(1);

    // Corrupt the stored locator so JSON.parse-then-validate throws.
    db.upsertManagedHook({
      projectId,
      providerId: 'claude-code',
      hookId: 'orphan',
      configPath: join(projectPath, '.claude', 'settings.json'),
      locator: '"not-an-array"',
      scriptPath: null,
    });
    expect(db.getManagedHooks(projectId)[0].locator).toBe('"not-an-array"');

    const result = pruneOrphanHooks(projectPath, projectId, [], ['claude-code'], db);
    expect(result.removed).toBe(0);
    expect(result.warnings.some((w) => /prune failed/.test(w))).toBe(true);
    // DB row preserved so the next run can retry — no orphan in config.
    expect(db.getManagedHooks(projectId)).toHaveLength(1);
  });

  it('cleanHooks wipes every entry and config keys for the project', async () => {
    await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
      hooks: [{ id: 'a', on: 'beforeShell', command: 'echo a' }],
      providers: ['claude-code'],
      db,
      authFetch: makeAuthFetch(),
      getRepoSnapshot: stubGetRepoSnapshot,
    });

    const { removed } = cleanHooks(projectPath, projectId, db);
    expect(removed).toBe(1);
    expect(db.getManagedHooks(projectId)).toEqual([]);
    const settings = JSON.parse(
      readFileSync(join(projectPath, '.claude', 'settings.json'), 'utf-8'),
    ) as any;
    expect(settings.hooks).toBeUndefined();
  });
});
