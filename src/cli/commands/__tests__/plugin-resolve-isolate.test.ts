import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';

function writeMinimalClaudePlugin(root: string, name = 'good-plugin'): void {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0' }),
  );
  mkdirSync(join(root, 'skills', 'hello-skill'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'hello-skill', 'SKILL.md'),
    '---\nname: hello-skill\ndescription: hi\n---\n\nHello.\n',
  );
}

/** Marketplace-style repo: catalog at root, no plugin.json. */
function writeMarketplaceCatalogRoot(root: string): void {
  mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.cursor-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'demo-market', plugins: [] }),
  );
}

describe('resolvePlugins isolates per-plugin failures', () => {
  let dir: string;
  let db: CapaDatabase;
  let goodSnapshot: string;
  let badSnapshot: string;
  let pluginsBase: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-isolate-'));
    goodSnapshot = join(dir, 'good-snapshot');
    badSnapshot = join(dir, 'bad-snapshot');
    pluginsBase = join(dir, 'plugins-base');
    projectPath = join(dir, 'project');
    mkdirSync(pluginsBase, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeMinimalClaudePlugin(goodSnapshot);
    writeMarketplaceCatalogRoot(badSnapshot);
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [claude-code]\n');

    const dbPath = join(dir, 'test.db');
    const sqlite = new Database(dbPath, { create: true });
    initSchema(sqlite);
    sqlite.close();
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'proj-isolate', path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps healthy plugins when another plugin has no manifest', async () => {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [
        {
          id: 'good-plugin',
          type: 'github',
          def: { repo: 'owner/good-plugin' },
        },
        {
          id: 'broken-market',
          type: 'github',
          def: { repo: 'owner/broken-market' },
        },
      ],
    };

    const result = await resolvePlugins(
      caps,
      projectPath,
      'proj-isolate',
      (async () => new Response()) as never,
      db,
      async (_platform, repoPath) => {
        if (repoPath.includes('broken')) {
          return {
            snapshotDir: badSnapshot,
            resolvedSha: 'b'.repeat(40),
            resolvedVersion: null,
          };
        }
        return {
          snapshotDir: goodSnapshot,
          resolvedSha: 'a'.repeat(40),
          resolvedVersion: null,
        };
      },
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      {
        materializeProjectSkills: false,
        pluginsBaseDir: pluginsBase,
        trackManaged: false,
      },
    );

    expect(
      result.mergedCapabilities.skills.some((s) => s.id === 'hello-skill'),
    ).toBe(true);
    expect(
      result.mergedCapabilities.resolvedPlugins?.some((p) => p.id === 'good-plugin'),
    ).toBe(true);
    expect(
      result.mergedCapabilities.resolvedPlugins?.some((p) => p.id === 'broken-market'),
    ).toBe(false);
    expect(existsSync(join(pluginsBase, 'good-plugin'))).toBe(true);
    expect(
      result.warnings.some(
        (w) =>
          w.includes('broken-market') &&
          w.includes('failed to resolve') &&
          w.includes('No plugin manifest found'),
      ),
    ).toBe(true);
  });

  it('keeps healthy plugins when another plugin fails to clone', async () => {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [
        {
          id: 'good-plugin',
          type: 'github',
          def: { repo: 'owner/good-plugin' },
        },
        {
          id: 'missing-repo',
          type: 'github',
          def: { repo: 'owner/missing-repo' },
        },
      ],
    };

    const result = await resolvePlugins(
      caps,
      projectPath,
      'proj-isolate',
      (async () => new Response()) as never,
      db,
      async (_platform, repoPath) => {
        if (repoPath.includes('missing')) {
          throw new Error('Repository not found');
        }
        return {
          snapshotDir: goodSnapshot,
          resolvedSha: 'a'.repeat(40),
          resolvedVersion: null,
        };
      },
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      {
        materializeProjectSkills: false,
        pluginsBaseDir: pluginsBase,
        trackManaged: false,
      },
    );

    expect(
      result.mergedCapabilities.skills.some((s) => s.id === 'hello-skill'),
    ).toBe(true);
    expect(
      result.warnings.some(
        (w) =>
          w.includes('missing-repo') &&
          w.includes('Failed to clone plugin'),
      ),
    ).toBe(true);
  });

  it('rolls back partial state when a plugin fails after lock upsert begins', async () => {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [
        {
          id: 'good-plugin',
          type: 'github',
          def: { repo: 'owner/good-plugin' },
        },
        {
          id: 'fail-late',
          type: 'github',
          def: { repo: 'owner/fail-late' },
        },
      ],
    };

    const lockBuilder = new LockfileBuilder(null);
    const origUpsert = lockBuilder.upsertPlugin.bind(lockBuilder);
    lockBuilder.upsertPlugin = (entry) => {
      if (entry.id === 'fail-late') {
        throw new Error('simulated late lock failure');
      }
      return origUpsert(entry);
    };

    const result = await resolvePlugins(
      caps,
      projectPath,
      'proj-isolate',
      (async () => new Response()) as never,
      db,
      async (_platform, repoPath) => {
        // Both plugins resolve to the same valid snapshot; fail-late dies at upsert.
        void repoPath;
        return {
          snapshotDir: goodSnapshot,
          resolvedSha: 'a'.repeat(40),
          resolvedVersion: null,
        };
      },
      join(projectPath, 'capabilities.yaml'),
      lockBuilder,
      {
        materializeProjectSkills: false,
        pluginsBaseDir: pluginsBase,
        trackManaged: false,
      },
    );

    expect(
      result.mergedCapabilities.skills.some((s) => s.id === 'hello-skill'),
    ).toBe(true);
    expect(
      result.mergedCapabilities.resolvedPlugins?.some((p) => p.id === 'good-plugin'),
    ).toBe(true);
    expect(
      result.mergedCapabilities.resolvedPlugins?.some((p) => p.id === 'fail-late'),
    ).toBe(false);
    expect(existsSync(join(pluginsBase, 'fail-late'))).toBe(false);
    expect(
      result.warnings.some(
        (w) =>
          w.includes('fail-late') &&
          w.includes('simulated late lock failure'),
      ),
    ).toBe(true);

    const built = lockBuilder.build();
    expect(built.plugins.some((p) => p.id === 'good-plugin')).toBe(true);
    expect(built.plugins.some((p) => p.id === 'fail-late')).toBe(false);
  });

});
