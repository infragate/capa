import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { cleanProject } from '../clean-project';
import type { Capabilities } from '../../../types/capabilities';

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
});
