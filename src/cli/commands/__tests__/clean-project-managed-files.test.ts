import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { cleanProject } from '../clean-project';
import type { Capabilities } from '../../../types/capabilities';

describe('cleanProject with managed files in the project', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-clean-managed-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('still cleans instruction files, rules, and MCP entries (platform path separators)', async () => {
    const projectPath = join(tempDir, 'project');
    const ruleFile = join(projectPath, '.cursor', 'rules', 'style.mdc');
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true });
    writeFileSync(ruleFile, 'Style.\n');
    writeFileSync(
      join(projectPath, 'AGENTS.md'),
      '<!-- capa:start:team -->\nTeam.\n<!-- capa:end:team -->\n',
    );
    writeFileSync(
      join(projectPath, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { capa: { url: 'http://127.0.0.1:1/p/mcp' }, other: { url: 'x' } } }),
    );

    const capabilities: Capabilities = { providers: ['cursor'], skills: [], servers: [], tools: [] };
    const db = new CapaDatabase(join(tempDir, 'capa.db'));
    db.upsertProject({ id: 'p', path: projectPath });
    // Recorded with the platform's native separators, as install does.
    db.addManagedFile('p', ruleFile);

    await cleanProject({ projectPath, projectId: 'p', db, capabilities });
    db.close();

    expect(existsSync(ruleFile)).toBe(false);
    expect(existsSync(join(projectPath, 'AGENTS.md'))).toBe(false);
    const mcp = JSON.parse(await Bun.file(join(projectPath, '.cursor', 'mcp.json')).text());
    expect(mcp.mcpServers.capa).toBeUndefined();
    expect(mcp.mcpServers.other).toBeDefined();
  });
});
