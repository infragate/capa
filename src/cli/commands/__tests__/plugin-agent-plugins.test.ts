import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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

  function run() {
    const caps: Capabilities = {
      providers: ['claude-code'],
      skills: [],
      servers: [],
      tools: [],
      plugins: [{ type: 'github', def: { repo: 'owner/reports-plugin' } }],
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
    const dataDir = resolve(dataBase, 'reports-plugin');

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
