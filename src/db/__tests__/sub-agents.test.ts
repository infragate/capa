import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CapaDatabase } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when no sub-agents installed', () => {
    expect(db.getSubAgents('proj-1')).toEqual([]);
  });

  it('upserts and retrieves a sub-agent', () => {
    db.upsertSubAgent('proj-1', 'infra-agent');
    const agents = db.getSubAgents('proj-1');
    expect(agents).toHaveLength(1);
    expect(agents[0].agent_id).toBe('infra-agent');
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
});
