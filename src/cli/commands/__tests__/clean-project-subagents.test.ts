import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
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
    writeFileSync(
      join(agentsDir, 'typescript-refactor-expert.md'),
      '**MCP server key:** `capa-typescript-refactor-expert`\n',
      'utf-8',
    );
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
    writeFileSync(
      join(agentsDir, 'api-agent.md'),
      '**MCP server key:** `capa-api-agent`\n',
      'utf-8',
    );

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

  it('preserves a same-name adapter owned by an excluded provider', async () => {
    const cursorAgentsDir = join(tempDir, '.cursor', 'agents');
    const claudeAgentsDir = join(tempDir, '.claude', 'agents');
    mkdirSync(cursorAgentsDir, { recursive: true });
    mkdirSync(claudeAgentsDir, { recursive: true });
    writeFileSync(
      join(cursorAgentsDir, 'reviewer.md'),
      '**MCP server key:** `capa-reviewer`\n',
      'utf-8',
    );
    writeFileSync(join(claudeAgentsDir, 'reviewer.md'), 'manual claude adapter', 'utf-8');

    const capabilities: Capabilities = {
      providers: ['claude-code', 'cursor'],
      skills: [],
      servers: [],
      tools: [],
      subagents: [
        {
          id: 'reviewer',
          providers: ['cursor'],
          skills: [],
          tools: [],
        },
      ],
    };
    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-subagents-0003';
    db.upsertProject({ id: projectId, path: tempDir });
    db.setProjectProviders(projectId, ['claude-code', 'cursor']);
    db.upsertSubAgent(projectId, 'reviewer', {
      installPath: tempDir,
      providerIds: ['cursor'],
      migrateLegacy: true,
    });

    await cleanProject({ projectPath: tempDir, projectId, db, capabilities });
    db.close();

    expect(existsSync(join(cursorAgentsDir, 'reviewer.md'))).toBe(false);
    expect(readFileSync(join(claudeAgentsDir, 'reviewer.md'), 'utf-8')).toBe(
      'manual claude adapter',
    );
  });

  it('cleans every historical provider for a legacy unscoped agent', async () => {
    const cursorAgent = join(tempDir, '.cursor', 'agents', 'reviewer.md');
    const claudeAgent = join(tempDir, '.claude', 'agents', 'reviewer.md');
    const cursorMcp = join(tempDir, '.cursor', 'mcp.json');
    mkdirSync(join(tempDir, '.cursor', 'agents'), { recursive: true });
    mkdirSync(join(tempDir, '.claude', 'agents'), { recursive: true });
    for (const filePath of [cursorAgent, claudeAgent]) {
      writeFileSync(filePath, '**MCP server key:** `capa-reviewer`\n', 'utf-8');
    }
    writeFileSync(
      cursorMcp,
      JSON.stringify({
        mcpServers: {
          'capa-reviewer': {
            url: 'http://localhost:5912/capa-clean-subagents-legacy/agents/reviewer/mcp',
          },
        },
      }),
      'utf-8',
    );

    const db = new CapaDatabase(dbPath);
    const projectId = 'capa-clean-subagents-legacy';
    db.upsertProject({ id: projectId, path: tempDir });
    db.setProjectProviders(projectId, ['claude-code', 'cursor']);
    db.upsertSubAgent(projectId, 'reviewer');

    await cleanProject({
      projectPath: tempDir,
      projectId,
      db,
      capabilities: {
        providers: ['cursor'],
        skills: [],
        servers: [],
        tools: [],
        subagents: [
          {
            id: 'reviewer',
            providers: ['cursor'],
            skills: [],
            tools: [],
          },
        ],
      },
    });
    db.close();

    expect(existsSync(cursorAgent)).toBe(false);
    expect(existsSync(claudeAgent)).toBe(false);
    expect(JSON.parse(readFileSync(cursorMcp, 'utf-8')).mcpServers).toEqual({});
  });
});
