import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { addCommand } from '../add';
import { upsertNativeMcpServer } from '../../utils/passthrough/native-mcp';
import { CapaDatabase } from '../../../db/database';
import { cleanProject } from '../clean-project';

describe('capa add --server (capabilities file)', () => {
  let tempDir: string;
  let prevCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-add-server-'));
    prevCwd = process.cwd();
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'capabilities.yaml'),
      'skills: []\nservers: []\ntools: []\n',
      'utf-8',
    );
  });

  afterEach(() => {
    process.chdir(prevCwd);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('appends an owl-style stdio server', async () => {
    await addCommand(undefined, {
      server: true,
      id: 'owl',
      cmd: 'npx',
      arg: ['-y', 'owl-mcp@1.0.14', 'serve'],
    });
    const yaml = readFileSync(join(tempDir, 'capabilities.yaml'), 'utf-8');
    expect(yaml).toContain('id: owl');
    expect(yaml).toContain('cmd: npx');
    expect(yaml).toContain('owl-mcp@1.0.14');
  });

  it('appends a remote URL server', async () => {
    await addCommand(undefined, {
      server: true,
      id: 'aws-knowledge',
      url: 'https://knowledge-mcp.global.api.aws',
    });
    const yaml = readFileSync(join(tempDir, 'capabilities.yaml'), 'utf-8');
    expect(yaml).toContain('id: aws-knowledge');
    expect(yaml).toContain('url: https://knowledge-mcp.global.api.aws');
  });

  it('appends a hook matching meta shape', async () => {
    await addCommand(undefined, {
      hook: true,
      id: 'update-projects',
      on: 'sessionStart',
      command: 'node scripts/update-projects.mjs',
      timeout: '120',
    });
    const yaml = readFileSync(join(tempDir, 'capabilities.yaml'), 'utf-8');
    expect(yaml).toContain('id: update-projects');
    expect(yaml).toContain('on: sessionStart');
    expect(yaml).toContain('timeout: 120');
  });

  it('appends a tool with defaults', async () => {
    await addCommand(undefined, {
      tool: true,
      id: 'search',
      mcpServer: '@atlassian',
      mcpTool: 'search',
      default: ['cloudId=abc'],
    });
    const yaml = readFileSync(join(tempDir, 'capabilities.yaml'), 'utf-8');
    expect(yaml).toContain('id: search');
    expect(yaml).toContain('server: "@atlassian"');
    expect(yaml).toContain('cloudId: abc');
  });
});

describe('passthrough MCP is not cleaned by capa clean', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-passthrough-clean-'));
    dbPath = join(tempDir, 'capa.db');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('leaves passthrough MCP entries after cleanProject', async () => {
    await upsertNativeMcpServer(
      tempDir,
      'owl',
      { cmd: 'npx', args: ['-y', 'owl-mcp@1.0.14', 'serve'] },
      ['cursor'],
    );
    const mcpPath = join(tempDir, '.cursor', 'mcp.json');
    expect(existsSync(mcpPath)).toBe(true);

    writeFileSync(
      join(tempDir, 'capabilities.yaml'),
      'providers:\n  - cursor\nskills: []\nservers: []\ntools: []\n',
      'utf-8',
    );

    const db = new CapaDatabase(dbPath);
    const projectId = 'test-passthrough-0001';
    db.upsertProject({ id: projectId, path: tempDir });
    db.setProjectProviders(projectId, ['cursor']);
    // Do NOT add managed_files for the mcp config — passthrough owns nothing.
    await cleanProject({ projectPath: tempDir, projectId, db });
    db.close();

    expect(existsSync(mcpPath)).toBe(true);
    const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(config.mcpServers.owl).toBeDefined();
  });
});
