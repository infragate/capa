import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';
import type { LockPluginEntry } from '../../../types/lockfile';

const SHA = 'a'.repeat(40);

function writeMinimalClaudePlugin(root: string, name = 'good-plugin'): void {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0' }),
  );
}

function previousPlugin(resolvedVersion: string | null, resolvedRef = SHA): LockPluginEntry {
  return {
    id: 'good-plugin',
    source: 'github',
    repo: 'owner/good-plugin',
    subpath: null,
    requestedSearchName: null,
    requestedVersion: null,
    requestedRef: null,
    resolvedRef,
    resolvedVersion,
    manifestName: 'good-plugin',
    manifestVersion: '1.0.0',
  };
}

describe('resolvePlugins preserves pinned resolvedVersion', () => {
  let dir: string;
  let db: CapaDatabase;
  let snapshotDir: string;
  let pluginsBase: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-lock-version-'));
    snapshotDir = join(dir, 'snapshot');
    pluginsBase = join(dir, 'plugins-base');
    projectPath = join(dir, 'project');
    mkdirSync(pluginsBase, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeMinimalClaudePlugin(snapshotDir);
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [claude-code]\n');

    const dbPath = join(dir, 'test.db');
    const sqlite = new Database(dbPath, { create: true });
    initSchema(sqlite);
    sqlite.close();
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'proj-lock', path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function resolve(
    lockBuilder: LockfileBuilder,
    opts?: { noCache?: boolean; resolvedVersion?: string | null },
  ) {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [{ id: 'good-plugin', type: 'github', def: { repo: 'owner/good-plugin' } }],
    };
    await resolvePlugins(
      caps,
      projectPath,
      'proj-lock',
      (async () => new Response()) as never,
      db,
      async () => ({
        snapshotDir,
        resolvedSha: SHA,
        resolvedVersion: opts?.resolvedVersion ?? null,
      }),
      join(projectPath, 'capabilities.yaml'),
      lockBuilder,
      {
        noCache: opts?.noCache,
        materializeProjectSkills: false,
        pluginsBaseDir: pluginsBase,
        trackManaged: false,
      },
    );
    return lockBuilder.build().plugins[0];
  }

  it('keeps the discovered tag when a pinned reinstall reports no version', async () => {
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertPlugin(previousPlugin('v1.2.3'));

    const entry = await resolve(lockBuilder);

    expect(entry?.resolvedRef).toBe(SHA);
    expect(entry?.resolvedVersion).toBe('v1.2.3');
  });

  it('uses a version the snapshot resolved over the previous tag', async () => {
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertPlugin(previousPlugin('v1.2.3'));

    const entry = await resolve(lockBuilder, { resolvedVersion: 'v2.0.0' });

    expect(entry?.resolvedVersion).toBe('v2.0.0');
  });

  it('does not restore a tag when --no-cache skips the pin', async () => {
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertPlugin(previousPlugin('v1.2.3'));

    const entry = await resolve(lockBuilder, { noCache: true });

    expect(entry?.resolvedVersion).toBeNull();
  });
});
