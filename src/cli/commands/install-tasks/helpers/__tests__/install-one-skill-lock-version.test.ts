import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../../../db/database';
import { LockfileBuilder } from '../../../../../shared/lockfile';
import { installOneSkill } from '../install-one-skill';
import * as repoSnapshot from '../repo-snapshot';
import type { Capabilities, Skill } from '../../../../../types/capabilities';
import type { LockSkillEntry } from '../../../../../types/lockfile';

const SHA = 'a'.repeat(40);

function previousSkill(resolvedVersion: string | null, resolvedRef = SHA): LockSkillEntry {
  return {
    id: 'my-skill',
    source: 'github',
    repo: 'owner/repo',
    skillName: 'my-skill',
    requestedVersion: null,
    requestedRef: null,
    resolvedRef,
    resolvedVersion,
  };
}

describe('installOneSkill preserves pinned resolvedVersion', () => {
  let tempDir: string;
  let projectPath: string;
  let snapshotDir: string;
  let db: CapaDatabase;
  let snapshotSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-skill-lock-version-'));
    projectPath = join(tempDir, 'project');
    snapshotDir = join(tempDir, 'snapshot');
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(join(snapshotDir, 'my-skill'), { recursive: true });
    writeFileSync(
      join(snapshotDir, 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: hi\n---\n\nHello.\n',
    );
    db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: 'proj', path: projectPath });
    snapshotSpy = spyOn(repoSnapshot, 'getRepoSnapshot').mockResolvedValue({
      snapshotDir,
      resolvedSha: SHA,
      resolvedVersion: null,
    });
  });

  afterEach(() => {
    snapshotSpy.mockRestore();
    db.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function install(lockBuilder: LockfileBuilder, noCache = false) {
    const skill: Skill = {
      id: 'my-skill',
      type: 'github',
      def: { repo: 'owner/repo@my-skill' },
    };
    const capabilities: Capabilities = {
      providers: ['cursor'],
      skills: [skill],
      servers: [],
      tools: [],
    };
    await installOneSkill(
      skill,
      projectPath,
      'proj',
      ['cursor'],
      db,
      { server: { host: '127.0.0.1', port: 5912 } },
      capabilities,
      join(projectPath, 'capabilities.yaml'),
      lockBuilder,
      noCache,
      new Map(),
    );
    return lockBuilder.build().skills[0];
  }

  it('keeps the discovered tag when a pinned reinstall reports no version', async () => {
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertSkill(previousSkill('v1.2.3'));

    const entry = await install(lockBuilder);

    expect(snapshotSpy).toHaveBeenCalled();
    expect(entry?.resolvedRef).toBe(SHA);
    expect(entry?.resolvedVersion).toBe('v1.2.3');
  });

  it('uses a version the snapshot resolved over the previous tag', async () => {
    snapshotSpy.mockResolvedValue({
      snapshotDir,
      resolvedSha: SHA,
      resolvedVersion: 'v2.0.0',
    });
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertSkill(previousSkill('v1.2.3'));

    const entry = await install(lockBuilder);

    expect(entry?.resolvedVersion).toBe('v2.0.0');
  });

  it('does not restore a tag when --no-cache skips the pin', async () => {
    const lockBuilder = new LockfileBuilder(null);
    lockBuilder.upsertSkill(previousSkill('v1.2.3'));

    const entry = await install(lockBuilder, true);

    expect(entry?.resolvedVersion).toBeNull();
  });
});
