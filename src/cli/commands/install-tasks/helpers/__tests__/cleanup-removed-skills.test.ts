import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../../../db/database';
import {
  cleanupRemovedSkills,
  isProviderSkillManagedPath,
} from '../cleanup-removed-skills';

describe('cleanupRemovedSkills', () => {
  let tempDir: string;
  let realProject: string;
  let shadowProject: string;
  let db: CapaDatabase;
  const projectId = 'wrap-proj';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-cleanup-skills-'));
    realProject = join(tempDir, 'real');
    shadowProject = join(tempDir, 'shadow');
    mkdirSync(realProject, { recursive: true });
    mkdirSync(shadowProject, { recursive: true });
    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: projectId, path: realProject });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('isProviderSkillManagedPath matches only skill dirs under projectPath', () => {
    const skillDir = join(realProject, '.cursor', 'skills', 'hello');
    expect(isProviderSkillManagedPath(realProject, skillDir, ['cursor'])).toBe(true);
    expect(
      isProviderSkillManagedPath(realProject, join(realProject, '.cursor', 'rules', 'r.mdc'), [
        'cursor',
      ]),
    ).toBe(false);
    expect(isProviderSkillManagedPath(shadowProject, skillDir, ['claude-code'])).toBe(false);
  });

  it('does not delete real-project cursor rules during a wrap shadow cleanup', async () => {
    const rulePath = join(realProject, '.cursor', 'rules', 'style-guide.mdc');
    mkdirSync(join(realProject, '.cursor', 'rules'), { recursive: true });
    writeFileSync(rulePath, '---\ndescription: style\n---\nBe consistent.\n');
    db.addManagedFile(projectId, rulePath);

    const skillPath = join(realProject, '.cursor', 'skills', 'kept-skill');
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, 'SKILL.md'), '# kept\n');
    db.addManagedFile(projectId, skillPath);

    const stats = await cleanupRemovedSkills(
      shadowProject,
      projectId,
      [{ id: 'kept-skill', def: { path: './skills/kept-skill' } } as any],
      ['claude-code'],
      db,
    );

    expect(stats.removed).toBe(0);
    expect(existsSync(rulePath)).toBe(true);
    expect(existsSync(skillPath)).toBe(true);
    expect(db.getManagedFiles(projectId)).toContain(rulePath);
    expect(db.getManagedFiles(projectId)).toContain(skillPath);
  });

  it('still removes orphan skill dirs for the active provider under projectPath', async () => {
    const orphan = join(shadowProject, '.claude', 'skills', 'gone-skill');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'SKILL.md'), '# gone\n');
    db.addManagedFile(projectId, orphan);

    const stats = await cleanupRemovedSkills(
      shadowProject,
      projectId,
      [],
      ['claude-code'],
      db,
    );

    expect(stats.removed).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(db.getManagedFiles(projectId)).not.toContain(orphan);
  });
});
