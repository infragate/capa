import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../../../db/database';
import { LockfileBuilder } from '../../../../../shared/lockfile';
import { installOneSkill } from '../install-one-skill';
import type { Capabilities, Skill } from '../../../../../types/capabilities';

describe('installOneSkill id hardening', () => {
  let tempDir: string;
  let projectPath: string;
  let outsidePath: string;
  let db: CapaDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-skill-id-'));
    projectPath = join(tempDir, 'project');
    outsidePath = join(tempDir, 'outside');
    require('fs').mkdirSync(projectPath, { recursive: true });
    require('fs').mkdirSync(outsidePath, { recursive: true });
    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: 'proj', path: projectPath });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects skill ids that leave the provider skills directory', async () => {
    const escapeId = join('..', '..', 'outside', 'pwned-skill').replace(/\\/g, '/');
    const skill: Skill = {
      id: escapeId,
      type: 'inline',
      def: { content: '# PWNED\n' },
    };
    const capabilities: Capabilities = {
      providers: ['cursor'],
      skills: [skill],
      servers: [],
      tools: [],
    };

    await expect(
      installOneSkill(
        skill,
        projectPath,
        'proj',
        ['cursor'],
        db,
        { server: { host: '127.0.0.1', port: 5912 } },
        capabilities,
        join(projectPath, 'capabilities.yaml'),
        new LockfileBuilder(null),
        true,
        new Map(),
      ),
    ).rejects.toThrow(/not allowed for install paths/);

    expect(existsSync(join(outsidePath, 'pwned-skill'))).toBe(false);
    expect(existsSync(join(outsidePath, 'pwned-skill', 'SKILL.md'))).toBe(false);
    // Skills dir should remain absent or empty of the escape target
    const skillsDir = join(projectPath, '.cursor', 'skills');
    if (existsSync(skillsDir)) {
      expect(readdirSync(skillsDir)).not.toContain('pwned-skill');
    }
  });

  it('installs a normal inline skill under the provider skills directory', async () => {
    const skill: Skill = {
      id: 'hello-skill',
      type: 'inline',
      def: { content: '# Hello\n' },
    };
    const capabilities: Capabilities = {
      providers: ['cursor'],
      skills: [skill],
      servers: [],
      tools: [],
    };

    const outcome = await installOneSkill(
      skill,
      projectPath,
      'proj',
      ['cursor'],
      db,
      { server: { host: '127.0.0.1', port: 5912 } },
      capabilities,
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      true,
      new Map(),
    );

    expect(outcome).toBe('installed');
    expect(existsSync(join(projectPath, '.cursor', 'skills', 'hello-skill', 'SKILL.md'))).toBe(
      true,
    );
  });
});
