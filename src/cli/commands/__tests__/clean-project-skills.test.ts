import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { cleanProject } from '../clean-project';
import type { Capabilities } from '../../../types/capabilities';
import { getWorkspacesDir, WORKSPACE_MARKER } from '../../../shared/workspaces/paths';
import { getProjectPluginDataDir } from '../../../shared/plugin-paths';

describe('cleanProject skill directories', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-clean-skills-'));
    dbPath = join(tempDir, 'capa.db');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('removes declared skill dirs even when they were never recorded in managed_files', async () => {
    const skillDir = join(tempDir, '.cursor', 'skills', 'web-design-guidelines');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: web-design-guidelines\n---\n', 'utf-8');

    const capabilities: Capabilities = {
      providers: ['cursor'],
      skills: [
        {
          id: 'web-design-guidelines',
          type: 'github',
          def: { repo: 'vercel-labs/agent-skills@web-design-guidelines' },
        },
      ],
      servers: [],
      tools: [],
    };

    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-skills-0001';
    const result = await cleanProject({ projectPath: tempDir, projectId, db, capabilities });
    db.close();

    expect(existsSync(skillDir)).toBe(false);
    expect(result.skillDirsRemoved).toBe(1);
  });

  it('keeps project skill sources under skills/ when no providers are on record (#324)', async () => {
    // After a passthrough install: no providers in capabilities or the DB.
    const write = (rel: string) => {
      mkdirSync(join(tempDir, rel), { recursive: true });
      writeFileSync(join(tempDir, rel, 'SKILL.md'), '# skill\n', 'utf-8');
    };
    write('skills/create-pull-request'); // a type: local source
    write('skills/remote-skill'); // unrelated project folder with a skill's id
    write('.claude/skills/remote-skill'); // what passthrough wrote

    const capabilities: Capabilities = {
      skills: [
        { id: 'create-pull-request', type: 'local', def: { path: 'skills/create-pull-request' } },
        { id: 'remote-skill', type: 'github', def: { repo: 'owner/repo@remote-skill' } },
      ],
      servers: [],
      tools: [],
    } as Capabilities;

    const db = new CapaDatabase(dbPath);
    await cleanProject({ projectPath: tempDir, projectId: 'capa-clean-324', db, capabilities });
    db.close();

    expect(existsSync(join(tempDir, 'skills', 'create-pull-request', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills', 'remote-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.claude', 'skills', 'remote-skill'))).toBe(false);
  });

  it('never deletes a local skill source, even for a resolved provider that installs into skills/', async () => {
    mkdirSync(join(tempDir, 'skills', 'mine'), { recursive: true });
    writeFileSync(join(tempDir, 'skills', 'mine', 'SKILL.md'), '# mine\n', 'utf-8');
    const capabilities: Capabilities = {
      providers: ['openclaw'],
      skills: [{ id: 'mine', type: 'local', def: { path: './skills/mine' } }],
      servers: [],
      tools: [],
    } as Capabilities;

    const db = new CapaDatabase(dbPath);
    await cleanProject({ projectPath: tempDir, projectId: 'capa-clean-324b', db, capabilities });
    db.close();

    expect(existsSync(join(tempDir, 'skills', 'mine', 'SKILL.md'))).toBe(true);
  });

  it('does not delete vendored skills when .cursor/skills symlinks to ../skills', async () => {
    mkdirSync(join(tempDir, 'skills', 'ci-monitor'), { recursive: true });
    writeFileSync(
      join(tempDir, 'skills', 'ci-monitor', 'SKILL.md'),
      '---\nname: ci-monitor\n---\n',
      'utf-8',
    );
    mkdirSync(join(tempDir, '.cursor'), { recursive: true });
    symlinkSync(join(tempDir, 'skills'), join(tempDir, '.cursor', 'skills'));

    const capabilities: Capabilities = {
      providers: ['cursor'],
      skills: [{ id: 'ci-monitor', type: 'local', def: { path: './skills/ci-monitor' } }],
      servers: [],
      tools: [],
    };

    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-skills-symlink';
    const result = await cleanProject({ projectPath: tempDir, projectId, db, capabilities });
    db.close();

    expect(existsSync(join(tempDir, 'skills', 'ci-monitor', 'SKILL.md'))).toBe(true);
    expect(result.skillDirsRemoved).toBe(0);
    expect(result.warnings.some((w) => w.includes('Skipped skill cleanup'))).toBe(true);
  });

  it('cleans wrap shadow managed files without sweeping the real project tree', async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'capa-clean-wrap-home-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    try {
      mkdirSync(join(tempDir, 'skills', 'demo-skill'), { recursive: true });
      writeFileSync(join(tempDir, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo\n---\n', 'utf-8');
      mkdirSync(join(tempDir, '.cursor'), { recursive: true });
      symlinkSync(join(tempDir, 'skills'), join(tempDir, '.cursor', 'skills'));

      const workspacesDir = getWorkspacesDir();
      const projectId = 'capa-clean-wrap-only';
      const cachePath = join(workspacesDir, `${projectId}-cursor`);
      const shadowPath = join(cachePath, 'project');
      const shadowSkillDir = join(shadowPath, '.cursor', 'skills', 'demo-skill');
      mkdirSync(shadowSkillDir, { recursive: true });
      writeFileSync(join(shadowSkillDir, 'SKILL.md'), '---\nname: demo\n---\n', 'utf-8');
      writeFileSync(
        join(cachePath, WORKSPACE_MARKER),
        JSON.stringify({
          realProjectPath: tempDir,
          providerId: 'cursor',
          workingDir: 'project',
        }),
        'utf-8',
      );

      const capabilities: Capabilities = {
        providers: ['cursor'],
        skills: [{ id: 'demo-skill', type: 'inline', def: { content: 'demo' } }],
        servers: [],
        tools: [],
      };

      const db = new CapaDatabase(dbPath);
      db.upsertProject({ id: projectId, path: tempDir });
      db.addManagedFile(projectId, shadowSkillDir);

      const result = await cleanProject({ projectPath: tempDir, projectId, db, capabilities });
      db.close();

      expect(existsSync(join(tempDir, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(shadowSkillDir)).toBe(false);
      expect(result.skillDirsRemoved).toBe(0);
      expect(result.workspacesPruned).toBe(1);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {}
    }
  });

  it("removes the project's plugin data dirs and leaves other projects' alone", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'capa-clean-data-home-'));
    process.env.HOME = home;
    try {
      const mine = join(getProjectPluginDataDir('capa-clean-data'), 'p-0123456789ab');
      const other = join(getProjectPluginDataDir('other-project'), 'p-0123456789ab');
      mkdirSync(mine, { recursive: true });
      mkdirSync(other, { recursive: true });
      writeFileSync(join(mine, 'token'), 'secret');

      const db = new CapaDatabase(dbPath);
      const capabilities: Capabilities = { providers: ['cursor'], skills: [], servers: [], tools: [] };
      await cleanProject({ projectPath: tempDir, projectId: 'capa-clean-data', db, capabilities });
      db.close();

      expect(existsSync(getProjectPluginDataDir('capa-clean-data'))).toBe(false);
      expect(existsSync(other)).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {}
    }
  });
});
