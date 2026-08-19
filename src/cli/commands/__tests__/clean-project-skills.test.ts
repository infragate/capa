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
});
