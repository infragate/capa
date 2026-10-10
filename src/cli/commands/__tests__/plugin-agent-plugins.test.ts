import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';

const MANIFEST_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

describe('resolvePlugins with an Agent Plugins package', () => {
  let dir: string;
  let snapshotDir: string;
  let pluginsBase: string;
  let dataBase: string;
  let projectPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-agent-plugin-'));
    snapshotDir = join(dir, 'snapshot');
    pluginsBase = join(dir, 'plugins-base');
    dataBase = join(dir, 'plugin-data');
    projectPath = join(dir, 'project');
    mkdirSync(join(snapshotDir, 'skills', 'summarize'), { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(
      join(snapshotDir, 'plugin.json'),
      JSON.stringify({ $schema: MANIFEST_SCHEMA, name: 'reports-plugin', version: '2.0.0' }),
    );
    writeFileSync(
      join(snapshotDir, 'skills', 'summarize', 'SKILL.md'),
      '---\nname: summarize\ndescription: Summarize. Use for reports.\n---\n\nBody\n',
    );
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [claude-code]\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(repo = 'owner/reports-plugin') {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [{ type: 'github', def: { repo } }],
    };
    return resolvePlugins(
      caps,
      projectPath,
      'proj-ap',
      (async () => new Response()) as never,
      // The DB is only used to track materialized project skills (disabled below).
      null as never,
      async () => ({ snapshotDir, resolvedSha: 'a'.repeat(40), resolvedVersion: null }),
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      { pluginsBaseDir: pluginsBase, pluginDataBaseDir: dataBase, materializeProjectSkills: false },
    );
  }

  /** The one `${PLUGIN_DATA}` dir created so far. */
  function onlyDataDir(): string {
    const names = readdirSync(dataBase);
    expect(names).toHaveLength(1);
    return resolve(dataBase, names[0]);
  }

  it('merges skills and stdio servers with PLUGIN_ROOT / PLUGIN_DATA', async () => {
    writeFileSync(
      join(snapshotDir, 'mcp.json'),
      JSON.stringify({
        $schema: MCP_SCHEMA,
        mcpServers: {
          validator: {
            type: 'stdio',
            command: './bin/validator',
            args: ['--data', '${PLUGIN_DATA}/cache'],
          },
          escape: { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/..' },
        },
      }),
    );
    const result = await run();
    const pluginRoot = resolve(pluginsBase, 'reports-plugin');
    const dataDir = onlyDataDir();
    expect(dataDir).toMatch(/[\\/]reports-plugin-[0-9a-f]{12}$/);

    expect(result.mergedCapabilities.resolvedPlugins?.[0]).toMatchObject({
      name: 'reports-plugin',
      version: '2.0.0',
      provider: 'agent-plugins',
    });
    expect(result.mergedCapabilities.skills.map((s) => s.id)).toEqual(['summarize']);
    const servers = result.mergedCapabilities.servers;
    expect(servers.map((s) => s.id)).toEqual(['validator']);
    expect(servers[0].def).toEqual({
      cmd: join(pluginRoot, 'bin', 'validator'),
      args: ['--data', `${dataDir}/cache`],
      env: { PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: dataDir },
      cwd: pluginRoot,
    });
    expect(existsSync(dataDir)).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining('server "escape" skipped: "cwd" resolves outside'),
    ]);
  });

  it('creates a ${PLUGIN_DATA} subfolder cwd and warns on a missing plugin cwd', async () => {
    writeFileSync(
      join(snapshotDir, 'mcp.json'),
      JSON.stringify({
        $schema: MCP_SCHEMA,
        mcpServers: {
          worker: { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/work' },
          nodir: { type: 'stdio', command: 'node', cwd: './missing' },
        },
      }),
    );
    const result = await run();
    expect(existsSync(resolve(onlyDataDir(), 'work'))).toBe(true);
    expect(result.mergedCapabilities.servers.map((s) => s.id)).toEqual(['worker', 'nodir']);
    expect(result.warnings).toEqual([
      expect.stringContaining('server "nodir" cwd'),
    ]);
  });

  it('skips only the server when its data dir cannot be created', async () => {
    writeFileSync(
      join(snapshotDir, 'mcp.json'),
      JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { worker: { type: 'stdio', command: 'node' } } }),
    );
    writeFileSync(dataBase, 'a file, not a dir');
    const result = await run();
    expect(result.mergedCapabilities.resolvedPlugins?.[0]?.id).toBe('reports-plugin');
    expect(result.mergedCapabilities.skills.map((s) => s.id)).toEqual(['summarize']);
    expect(result.mergedCapabilities.servers).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('server "worker" skipped')]);
  });

  it('never swaps the shared plugins dir for a name that maps to an empty id', async () => {
    writeFileSync(
      join(snapshotDir, 'plugin.json'),
      JSON.stringify({ $schema: MANIFEST_SCHEMA, name: '!!!' }),
    );
    mkdirSync(pluginsBase, { recursive: true });
    writeFileSync(join(pluginsBase, 'keep.txt'), 'other plugin state');
    const result = await run();
    expect(existsSync(join(pluginsBase, 'keep.txt'))).toBe(true);
    expect(result.mergedCapabilities.resolvedPlugins?.[0]?.id).toBe('reports-plugin');
    expect(existsSync(join(pluginsBase, 'reports-plugin', 'plugin.json'))).toBe(true);
    expect(result.mergedCapabilities.skills.map((s) => s.id)).toEqual(['summarize']);
  });

  it('keys the data dir by plugin source, not the plugin-chosen name', async () => {
    writeFileSync(
      join(snapshotDir, 'mcp.json'),
      JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { worker: { type: 'stdio', command: 'node' } } }),
    );
    await run('owner/reports-plugin');
    const first = onlyDataDir();
    writeFileSync(join(first, 'token'), 'secret');

    // Same manifest name from another repo: a fresh dir, and the old one is
    // swept because its plugin is no longer declared.
    const result = await run('someone/else');
    const second = onlyDataDir();
    expect(second).not.toBe(first);
    expect(second).toMatch(/[\\/]else-[0-9a-f]{12}$/);
    expect(existsSync(first)).toBe(false);
    expect(result.mergedCapabilities.servers[0].def.env).toMatchObject({ PLUGIN_DATA: second });

    // A renamed manifest from the same source keeps its data.
    writeFileSync(join(second, 'token'), 'kept');
    writeFileSync(
      join(snapshotDir, 'plugin.json'),
      JSON.stringify({ $schema: MANIFEST_SCHEMA, name: 'renamed' }),
    );
    await run('someone/else');
    expect(onlyDataDir()).toBe(second);
    expect(existsSync(join(second, 'token'))).toBe(true);
  });

  it('strips terminal control characters from plugin warnings', async () => {
    writeFileSync(
      join(snapshotDir, 'plugin.json'),
      JSON.stringify({ $schema: MANIFEST_SCHEMA, name: 'x\u001b]52;c;Y3VybA==\u0007', ['\u001b[2K']: 1 }),
    );
    const result = await run();
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const w of result.warnings) {
      expect(w).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
    expect(result.warnings).toContain('Plugin "x]52;c;Y3VybA==": plugin.json: unknown field "[2K" ignored');
  });

  it('keeps skills when mcp.json is broken', async () => {
    writeFileSync(join(snapshotDir, 'mcp.json'), '{ broken');
    const result = await run();
    expect(result.mergedCapabilities.skills.map((s) => s.id)).toEqual(['summarize']);
    expect(result.mergedCapabilities.servers).toEqual([]);
    expect(result.warnings).toEqual([
      'Plugin "reports-plugin": mcp.json is not valid JSON; MCP servers disabled for this plugin',
    ]);
  });
});
