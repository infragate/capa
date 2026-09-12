import { describe, it, expect } from 'bun:test';
import {
  buildServerEntry,
  buildToolEntry,
  buildHookEntry,
  buildRuleEntry,
  resolveAddKind,
  parseKeyValueList,
} from '../add-builders';

describe('resolveAddKind', () => {
  it('defaults to skill', () => {
    expect(resolveAddKind({})).toBe('skill');
  });

  it('rejects multiple kinds', () => {
    expect(() => resolveAddKind({ server: true, tool: true })).toThrow(/Cannot combine/);
  });
});

describe('buildServerEntry', () => {
  it('builds stdio owl-style server', () => {
    const entry = buildServerEntry({
      id: 'owl',
      cmd: 'npx',
      arg: ['-y', 'owl-mcp@1.0.14', 'serve'],
    });
    expect(entry).toEqual({
      id: 'owl',
      type: 'mcp',
      // A new server exposes its tools by default — otherwise nothing on it
      // is callable until the user writes a `tools:` entry per tool.
      expose: 'all',
      def: {
        cmd: 'npx',
        args: ['-y', 'owl-mcp@1.0.14', 'serve'],
      },
    });
  });

  it('takes an except/exactly denylist from --tools', () => {
    const entry = buildServerEntry({
      id: 'github',
      url: 'https://example.com/mcp',
      expose: 'except',
      tools: 'delete_repo, force_push',
    });
    expect(entry.expose).toBe('except');
    expect(entry.tools).toEqual(['delete_repo', 'force_push']);
  });

  it('omits the policy for --expose none (explicit tools: only)', () => {
    const entry = buildServerEntry({
      id: 'github',
      url: 'https://example.com/mcp',
      expose: 'none',
    });
    expect(entry.expose).toBeUndefined();
    expect(entry.tools).toBeUndefined();
  });

  it('rejects except/exactly without tool names, and names without a mode', () => {
    expect(() =>
      buildServerEntry({ id: 'x', url: 'https://x', expose: 'exactly' }),
    ).toThrow(/requires --tools/);
    expect(() =>
      buildServerEntry({ id: 'x', url: 'https://x', tools: 'a,b' }),
    ).toThrow(/--tools requires --expose/);
    expect(() =>
      buildServerEntry({ id: 'x', url: 'https://x', expose: 'some' }),
    ).toThrow(/Unknown --expose/);
  });

  it('builds remote URL server', () => {
    const entry = buildServerEntry({
      id: 'aws-knowledge',
      type: 'mcp',
      url: 'https://knowledge-mcp.global.api.aws',
      description: 'AWS docs',
    });
    expect(entry.id).toBe('aws-knowledge');
    expect(entry.type).toBe('mcp');
    expect((entry.def as any).url).toBe('https://knowledge-mcp.global.api.aws');
    expect(entry.description).toBe('AWS docs');
  });

  it('rejects unknown server type', () => {
    expect(() =>
      buildServerEntry({ id: 'x', type: 'openapi', url: 'https://example.com' }),
    ).toThrow(/Unsupported server type/);
  });

  it('requires cmd or url xor', () => {
    expect(() => buildServerEntry({ id: 'x' })).toThrow(/exactly one/);
    expect(() =>
      buildServerEntry({ id: 'x', cmd: 'npx', url: 'https://x' }),
    ).toThrow(/exactly one/);
  });

  it('builds env from literals and external sources', () => {
    const entry = buildServerEntry({
      id: 'brave',
      cmd: 'npx',
      env: ['NODE_ENV=production'],
      envFromEnv: ['BRAVE_API_KEY=BRAVE_API_KEY'],
      envFromCommand: ['OTHER=op read op://Vault/Item/credential'],
      envFromFile: ['TOKEN=./secrets/token'],
    });
    expect(entry.def.env).toEqual({
      NODE_ENV: 'production',
      BRAVE_API_KEY: { fromEnv: 'BRAVE_API_KEY' },
      OTHER: { fromCommand: 'op read op://Vault/Item/credential' },
      TOKEN: { fromFile: './secrets/token' },
    });
  });

  it('builds headers from external sources', () => {
    const entry = buildServerEntry({
      id: 'remote',
      url: 'https://mcp.example.com',
      headerFromEnv: ['Authorization=MCP_BEARER'],
    });
    expect(entry.def.headers).toEqual({
      Authorization: { fromEnv: 'MCP_BEARER' },
    });
  });
});

describe('buildToolEntry', () => {
  it('builds MCP tool with defaults', () => {
    const entry = buildToolEntry({
      id: 'search',
      mcpServer: 'atlassian',
      mcpTool: 'search',
      default: ['cloudId=4cb87cf8-test'],
    });
    expect(entry).toEqual({
      id: 'search',
      type: 'mcp',
      def: {
        server: '@atlassian',
        tool: 'search',
        defaults: { cloudId: '4cb87cf8-test' },
      },
    });
  });

  it('builds command tool', () => {
    const entry = buildToolEntry({
      id: 'greet',
      command: 'echo Hello',
    });
    expect(entry.type).toBe('command');
    expect((entry.def as any).run.cmd).toBe('echo Hello');
  });
});

describe('buildHookEntry', () => {
  it('builds meta-style sessionStart hook', () => {
    const entry = buildHookEntry({
      id: 'update-projects',
      on: 'sessionStart',
      command: 'node scripts/update-projects.mjs',
      timeout: '120',
    });
    expect(entry).toEqual({
      id: 'update-projects',
      on: 'sessionStart',
      type: 'command',
      command: 'node scripts/update-projects.mjs',
      timeout: 120,
    });
  });

  it('rejects invalid events', () => {
    expect(() =>
      buildHookEntry({ id: 'x', on: 'not-an-event', command: 'echo' }),
    ).toThrow(/Invalid hook event/);
  });
});

describe('buildRuleEntry', () => {
  it('builds inline always-apply rule', async () => {
    const entry = await buildRuleEntry({
      id: 'code-style',
      inline: 'Prefer const',
      alwaysApply: true,
    });
    expect(entry).toEqual({
      id: 'code-style',
      type: 'inline',
      content: 'Prefer const',
      alwaysApply: true,
    });
  });
});

describe('parseKeyValueList', () => {
  it('parses KEY=VALUE pairs', () => {
    expect(parseKeyValueList(['A=1', 'B=two=parts'])).toEqual({ A: '1', B: 'two=parts' });
  });
});
