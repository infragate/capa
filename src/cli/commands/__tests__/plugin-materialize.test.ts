import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';

function writeMinimalClaudePlugin(root: string): void {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'fixture-plugin', version: '1.0.0' }),
  );
  mkdirSync(join(root, 'skills', 'hello-skill'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'hello-skill', 'SKILL.md'),
    '---\nname: hello-skill\ndescription: hi\n---\n\nHello.\n',
  );
}

describe('resolvePlugins materializeProjectSkills', () => {
  let dir: string;
  let db: CapaDatabase;
  let snapshotDir: string;
  let pluginsBase: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-mat-'));
    snapshotDir = join(dir, 'snapshot');
    pluginsBase = join(dir, 'plugins-base');
    projectPath = join(dir, 'project');
    mkdirSync(snapshotDir, { recursive: true });
    mkdirSync(pluginsBase, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeMinimalClaudePlugin(snapshotDir);
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [claude-code]\n');

    const dbPath = join(dir, 'test.db');
    const sqlite = new Database(dbPath, { create: true });
    initSchema(sqlite);
    sqlite.close();
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'proj-mat', path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(materializeProjectSkills: boolean) {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [
        {
          id: 'fixture-plugin',
          type: 'github',
          def: { repo: 'owner/fixture-plugin' },
        },
      ],
    };
    return resolvePlugins(
      caps,
      projectPath,
      'proj-mat',
      (async () => new Response()) as never,
      db,
      async () => ({
        snapshotDir,
        resolvedSha: 'a'.repeat(40),
        resolvedVersion: null,
      }),
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      { materializeProjectSkills, pluginsBaseDir: pluginsBase, trackManaged: true },
    );
  }

  it('materializes plugin skills into the project skills dir by default', async () => {
    const result = await run(true);
    expect(result.mergedCapabilities.skills.some((s) => s.id === 'hello-skill')).toBe(
      true,
    );
    const dest = join(projectPath, '.claude', 'skills', 'hello-skill', 'SKILL.md');
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toContain('Hello');
    expect(existsSync(join(pluginsBase, 'fixture-plugin'))).toBe(true);
  });

  it('skips project-local skill trees when materializeProjectSkills is false', async () => {
    const result = await run(false);
    expect(result.mergedCapabilities.skills.some((s) => s.id === 'hello-skill')).toBe(
      true,
    );
    expect(existsSync(join(projectPath, '.claude'))).toBe(false);
    // Plugins still unpack under the global capa plugins base.
    expect(existsSync(join(pluginsBase, 'fixture-plugin', 'skills', 'hello-skill'))).toBe(
      true,
    );
    expect(db.getManagedFiles('proj-mat')).toEqual([]);
  });
});
