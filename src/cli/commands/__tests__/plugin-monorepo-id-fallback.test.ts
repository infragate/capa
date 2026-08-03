import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';

function writeNestedCursorPlugin(repoRoot: string, pluginDir: string, name: string): void {
  mkdirSync(join(repoRoot, '.cursor-plugin'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cursor-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'demo-market', plugins: [{ name, source: pluginDir }] }),
  );
  const root = join(repoRoot, pluginDir);
  mkdirSync(join(root, '.cursor-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.cursor-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0' }),
  );
  mkdirSync(join(root, 'skills', 'nested-skill'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'nested-skill', 'SKILL.md'),
    '---\nname: nested-skill\ndescription: hi\n---\n\nHello.\n',
  );
}

describe('resolvePlugins monorepo id fallback', () => {
  let dir: string;
  let db: CapaDatabase;
  let snapshotDir: string;
  let pluginsBase: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-mono-'));
    snapshotDir = join(dir, 'snapshot');
    pluginsBase = join(dir, 'plugins-base');
    projectPath = join(dir, 'project');
    mkdirSync(pluginsBase, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeNestedCursorPlugin(snapshotDir, 'widget', 'widget');
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [cursor]\n');

    const dbPath = join(dir, 'test.db');
    const sqlite = new Database(dbPath, { create: true });
    initSchema(sqlite);
    sqlite.close();
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'proj-mono', path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a nested plugin when only the entry id is set (no ::/@)', async () => {
    const caps: Capabilities = {
      providers: ['cursor'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [
        {
          id: 'widget',
          type: 'github',
          def: { repo: 'acme/plugins-monorepo' },
        },
      ],
    };

    const result = await resolvePlugins(
      caps,
      projectPath,
      'proj-mono',
      (async () => new Response()) as never,
      db,
      async () => ({
        snapshotDir,
        resolvedSha: 'a'.repeat(40),
        resolvedVersion: null,
      }),
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      {
        materializeProjectSkills: false,
        pluginsBaseDir: pluginsBase,
        trackManaged: false,
      },
    );

    expect(
      result.mergedCapabilities.skills.some((s) => s.id === 'nested-skill'),
    ).toBe(true);
    expect(
      result.mergedCapabilities.resolvedPlugins?.some((p) => p.id === 'widget'),
    ).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
