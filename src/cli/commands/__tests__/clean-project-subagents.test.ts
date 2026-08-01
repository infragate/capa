import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { cleanProject } from '../clean-project';
import type { Capabilities } from '../../../types/capabilities';

describe('cleanProject sub-agent files', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-clean-subagents-'));
    dbPath = join(tempDir, 'capa.db');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('removes .cursor/agents files listed in capabilities even with no providers: and empty DB', async () => {
    const agentsDir = join(tempDir, '.cursor', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'typescript-refactor-expert.md'), '---\nname: x\n---\n', 'utf-8');
    writeFileSync(join(agentsDir, 'unrelated-manual.md'), 'keep me', 'utf-8');

    const capabilities: Capabilities = {
      // Intentionally omit providers — mirrors interactive install + yaml without providers:
      skills: [],
      servers: [],
      tools: [],
      subagents: [
        { id: 'typescript-refactor-expert', description: 'refactor', skills: [], tools: [] },
      ],
    };

    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-subagents-0001';
    // No project row / no sub_agents rows — previous clean wiped the DB first.
    await cleanProject({ projectPath: tempDir, projectId, db, capabilities });
    db.close();

    expect(existsSync(join(agentsDir, 'typescript-refactor-expert.md'))).toBe(false);
    expect(existsSync(join(agentsDir, 'unrelated-manual.md'))).toBe(true);
  });

  it('removes DB-tracked sub-agents when capabilities omits the subagents block', async () => {
    const agentsDir = join(tempDir, '.cursor', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'api-agent.md'), '---\nname: api-agent\n---\n', 'utf-8');

    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-subagents-0002';
    db.upsertProject({ id: projectId, path: tempDir });
    db.setProjectProviders(projectId, ['cursor']);
    db.upsertSubAgent(projectId, 'api-agent');

    await cleanProject({
      projectPath: tempDir,
      projectId,
      db,
      capabilities: { skills: [], servers: [], tools: [] },
    });
    db.close();

    expect(existsSync(join(agentsDir, 'api-agent.md'))).toBe(false);
  });
});
