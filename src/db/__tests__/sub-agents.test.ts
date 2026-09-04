import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CapaDatabase } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { canonicalizePath } from '../../shared/paths';
import { Database } from 'bun:sqlite';

describe('CapaDatabase — sub-agent operations', () => {
  let db: CapaDatabase;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-subagent-db-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: 'proj-1', path: '/test/project' });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('returns empty array when no sub-agents installed', () => {
    expect(db.getSubAgents('proj-1')).toEqual([]);
  });

  it('upserts and retrieves a sub-agent', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    const agents = db.getSubAgents('proj-1');
    expect(agents).toHaveLength(1);
    expect(agents[0].agent_id).toBe('infra-agent');
    expect(agents[0].legacy_unscoped).toBe(true);
    expect(agents[0].installations).toEqual([]);
  });

  it('records provider ownership separately for each install path', () => {
    const rootPath = join(tempDir, 'root');
    const shadowPath = join(tempDir, 'shadow');
    db.upsertSubAgent(
      'proj-1',
      'infra-agent',
      {
        installPath: rootPath,
        providerIds: ['claude-code', 'codex'],
        migrateLegacy: true,
      },
    );
    db.upsertSubAgent(
      'proj-1',
      'infra-agent',
      {
        installPath: shadowPath,
        providerIds: ['cursor'],
        migrateLegacy: false,
      },
    );

    let agent = db.getSubAgents('proj-1')[0];
    expect(agent.legacy_unscoped).toBe(false);
    expect(agent.installations).toEqual([
      {
        install_path: canonicalizePath(rootPath),
        provider_ids: ['claude-code', 'codex'],
      },
      {
        install_path: canonicalizePath(shadowPath),
        provider_ids: ['cursor'],
      },
    ]);

    db.upsertSubAgent('proj-1', 'infra-agent', {
      installPath: rootPath,
      providerIds: ['gemini-cli'],
      migrateLegacy: true,
    });
    agent = db.getSubAgents('proj-1')[0];
    expect(agent.installations).toEqual([
      {
        install_path: canonicalizePath(rootPath),
        provider_ids: ['gemini-cli'],
      },
      {
        install_path: canonicalizePath(shadowPath),
        provider_ids: ['cursor'],
      },
    ]);
  });

  it('keeps an agent until its final scoped installation is removed', () => {
    const rootPath = join(tempDir, 'root');
    const shadowPath = join(tempDir, 'shadow');
    db.upsertSubAgent('proj-1', 'infra-agent', {
      installPath: rootPath,
      providerIds: ['claude-code'],
      migrateLegacy: true,
    });
    db.upsertSubAgent('proj-1', 'infra-agent', {
      installPath: shadowPath,
      providerIds: ['cursor'],
      migrateLegacy: false,
    });

    db.removeSubAgentInstallation('proj-1', 'infra-agent', {
      installPath: shadowPath,
      removeLegacy: false,
    });
    expect(db.getSubAgents('proj-1')).toHaveLength(1);

    db.removeSubAgentInstallation('proj-1', 'infra-agent', {
      installPath: rootPath,
      removeLegacy: true,
    });
    expect(db.getSubAgents('proj-1')).toEqual([]);
  });

  it('upsert is idempotent — no duplicate rows', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.upsertSubAgent('proj-1', 'infra-agent');
    expect(db.getSubAgents('proj-1')).toHaveLength(1);
  });

  it('tracks multiple sub-agents per project', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.upsertSubAgent('proj-1', 'api-agent');
    const agents = db.getSubAgents('proj-1');
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.agent_id).sort()).toEqual(['api-agent', 'infra-agent']);
  });

  it('removes a specific sub-agent', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.upsertSubAgent('proj-1', 'api-agent');
    db.removeSubAgent('proj-1', 'infra-agent');
    const agents = db.getSubAgents('proj-1');
    expect(agents).toHaveLength(1);
    expect(agents[0].agent_id).toBe('api-agent');
  });

  it('removeSubAgent is a no-op when agent does not exist', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.removeSubAgent('proj-1', 'non-existent');
    expect(db.getSubAgents('proj-1')).toHaveLength(1);
  });

  it('sub-agents are isolated per project', () => {
    db.upsertProject({ id: 'proj-2', path: '/other/project' });
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.upsertSubAgent('proj-2', 'chat-agent');
    expect(db.getSubAgents('proj-1').map(a => a.agent_id)).toEqual(['infra-agent']);
    expect(db.getSubAgents('proj-2').map(a => a.agent_id)).toEqual(['chat-agent']);
  });

  it('deleteProject cascades to sub_agents', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    db.upsertSubAgent('proj-1', 'api-agent');
    db.deleteProject('proj-1');
    // After project deletion the project is gone; re-create to check table is empty
    db.upsertProject({ id: 'proj-1', path: '/test/project' });
    expect(db.getSubAgents('proj-1')).toHaveLength(0);
  });

  it('migrates pre-scoped sub-agent rows as legacy ownership', () => {
    const legacyPath = join(tempDir, 'legacy.db');
    const raw = new Database(legacyPath, { create: true });
    raw.run(`
      CREATE TABLE sub_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, agent_id)
      )
    `);
    raw.run(
      'INSERT INTO sub_agents (project_id, agent_id, created_at) VALUES (?, ?, ?)',
      ['legacy-project', 'reviewer', Date.now()],
    );
    raw.close();

    const migrated = new CapaDatabase(legacyPath);
    expect(migrated.getSubAgents('legacy-project')).toEqual([
      {
        agent_id: 'reviewer',
        legacy_unscoped: true,
        installations: [],
      },
    ]);
    migrated.close();
  });
});
