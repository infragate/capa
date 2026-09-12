import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  parseCapabilitiesFile,
  createDefaultCapabilities,
  writeCapabilitiesFile,
  normalizeCapabilities,
  appendCapabilityEntry,
  removeCapabilityEntry,
  updateCapabilityEntry,
  reorderCapabilityEntries,
  upsertOptions,
  upsertAgents,
} from '../capabilities';
import { logger } from '../logger';
import { mkdtempSync, rmSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Capabilities } from '../../types/capabilities';

describe('capabilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-capabilities-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('normalizeCapabilities', () => {
    it('throws a clear error for null input', () => {
      expect(() => normalizeCapabilities(null)).toThrow(
        'capabilities file is empty or not a YAML/JSON object'
      );
    });

    it('throws a clear error for undefined input', () => {
      expect(() => normalizeCapabilities(undefined)).toThrow(
        'capabilities file is empty or not a YAML/JSON object'
      );
    });

    it('throws a clear error for non-object input', () => {
      expect(() => normalizeCapabilities('not-an-object')).toThrow(
        'capabilities file is empty or not a YAML/JSON object'
      );
      expect(() => normalizeCapabilities([])).toThrow(
        'capabilities file is empty or not a YAML/JSON object'
      );
    });

    it('defaults missing skills to an empty array', () => {
      const result = normalizeCapabilities({});
      expect(result.skills).toEqual([]);
    });

    it('defaults missing servers, tools, plugins, rules, subagents, and hooks to empty arrays', () => {
      const result = normalizeCapabilities({});
      expect(result.servers).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.plugins).toEqual([]);
      expect(result.rules).toEqual([]);
      expect(result.subagents).toEqual([]);
      expect(result.hooks).toEqual([]);
    });

    it('defaults missing options to an empty object', () => {
      const result = normalizeCapabilities({});
      expect(result.options).toEqual({});
    });

    it('keeps unknown top-level keys and warns', () => {
      const warnSpy = spyOn(logger, 'warn').mockImplementation(() => {});
      const result = normalizeCapabilities({ unknownKey: 'value', skills: [] }) as Capabilities & {
        unknownKey: string;
      };
      expect(result.unknownKey).toBe('value');
      expect(warnSpy).toHaveBeenCalledWith(
        'capabilities: unknown top-level key "unknownKey"'
      );
      warnSpy.mockRestore();
    });

    it('passes through a fully populated valid capabilities object unchanged', () => {
      const capabilities: Capabilities = {
        providers: ['cursor'],
        skills: [
          {
            id: 'my-skill',
            type: 'inline',
            def: { content: '# Skill' },
          },
        ],
        servers: [
          {
            id: 'my-server',
            type: 'mcp',
            def: { url: 'http://localhost:3000' },
          },
        ],
        tools: [
          {
            id: 'my-tool',
            type: 'mcp',
            def: { server: '@my-server', tool: 'search' },
          },
        ],
        plugins: [{ id: 'my-plugin', type: 'github', def: { repo: 'owner/repo' } }],
        options: { toolExposure: 'on-demand' },
        subagents: [
          {
            id: 'researcher',
            skills: ['my-skill'],
            tools: ['my-tool'],
          },
        ],
        rules: [{ id: 'my-rule', type: 'inline', content: 'Always be helpful.' }],
        hooks: [
          {
            id: 'my-hook',
            on: 'sessionStart',
            command: 'echo hello',
          },
        ],
      };

      const result = normalizeCapabilities(capabilities);
      expect(result).toEqual(capabilities);
    });

    it('validates and preserves sub-agent provider allow-lists', () => {
      const result = normalizeCapabilities({
        subagents: [
          {
            id: 'reviewer',
            providers: ['claude-code', 'codex'],
            skills: [],
            tools: [],
          },
        ],
      });

      expect(result.subagents?.[0].providers).toEqual(['claude-code', 'codex']);
      expect(
        normalizeCapabilities({
          subagents: [{ id: 'reviewer', providers: ['CLAUDE-CODE'] }],
        }).subagents?.[0].providers,
      ).toEqual(['claude-code']);
      expect(() =>
        normalizeCapabilities({
          subagents: [{ id: 'reviewer', providers: 'claude-code' }],
        }),
      ).toThrow(/subagents\.0\.providers/);
      expect(() =>
        normalizeCapabilities({
          subagents: [{ id: 'reviewer', providers: [''] }],
        }),
      ).toThrow(/subagents\.0\.providers\.0/);
      expect(() =>
        normalizeCapabilities({
          subagents: [{ id: 'reviewer', providers: ['not-a-provider'] }],
        }),
      ).toThrow(/subagents\.0\.providers\.0: Unknown provider: not-a-provider/);
    });

    it('normalizes legacy oauth2 aliases on servers at load', () => {
      const result = normalizeCapabilities({
        skills: [],
        servers: [
          {
            id: 'slack',
            type: 'mcp',
            def: {
              url: 'https://mcp.slack.com/mcp',
              oauth2: {
                client_id: 'legacy-app',
                callback_port: 3118,
                authorizationUrl: 'https://auth.example/authorize',
                tokenUrl: 'https://auth.example/token',
              },
            },
          },
        ],
        tools: [],
      });
      expect(result.servers[0].def.oauth2).toEqual({
        clientId: 'legacy-app',
        callbackPort: 3118,
        authorizationEndpoint: 'https://auth.example/authorize',
        tokenEndpoint: 'https://auth.example/token',
      });
    });

    it('accepts the none opt-out and keeps tools tied to except/exactly', () => {
      const withExtra = (extra: Record<string, unknown>) => ({
        servers: [
          { id: 's', type: 'mcp', def: { url: 'https://example.test/mcp' }, ...extra },
        ],
      });

      expect(
        normalizeCapabilities(withExtra({ expose: 'none' })).servers[0].expose,
      ).toBe('none');
      // Omitted stays omitted — `all` is the default, not something capa writes.
      expect(normalizeCapabilities(withExtra({})).servers[0].expose).toBeUndefined();
      expect(() =>
        normalizeCapabilities(withExtra({ expose: 'none', tools: ['a'] })),
      ).toThrow(/only applies to expose/);
    });

    it('validates expose/tools combinations on plugin servers too', () => {
      const plugin = (servers: Record<string, unknown>) => ({
        plugins: [{ type: 'github', def: { repo: 'o/r' }, servers }],
      });

      expect(() =>
        normalizeCapabilities(plugin({ slack: { expose: 'exactly' } })),
      ).toThrow(/needs a "tools" list/);
      expect(() =>
        normalizeCapabilities(plugin({ slack: { expose: 'all', tools: ['a'] } })),
      ).toThrow(/only applies to expose/);
      expect(() =>
        normalizeCapabilities(plugin({ slack: { tools: ['a'] } })),
      ).toThrow(/only applies to expose/);
      expect(
        normalizeCapabilities(
          plugin({ slack: { as: 'slack', expose: 'except', tools: ['rm'] } }),
        ).plugins?.[0]?.servers?.slack,
      ).toEqual({ as: 'slack', expose: 'except', tools: ['rm'] });
    });

    it('rejects MCP servers missing both url and cmd', () => {
      expect(() =>
        normalizeCapabilities({
          servers: [{ id: 'bad', type: 'mcp', def: {} }],
        }),
      ).toThrow(/url or cmd/);
    });
  });

  describe('null fields read as absent', () => {
    it('accepts a server whose description is an explicit null', () => {
      const caps = normalizeCapabilities({
        providers: ['claude-code'],
        servers: [
          {
            id: 'sharecube',
            type: 'mcp',
            def: { url: 'https://example.test/mcp' },
            description: null,
          },
        ],
      });

      expect(caps.servers[0].id).toBe('sharecube');
      expect(caps.servers[0].description).toBeUndefined();
    });

    it('keeps a null that is a tool default, not an absent field', () => {
      const caps = normalizeCapabilities({
        providers: ['claude-code'],
        servers: [{ id: 's', type: 'mcp', def: { url: 'https://example.test/mcp' } }],
        tools: [
          {
            id: 'search',
            type: 'mcp',
            def: { server: '@s', tool: 'search', defaults: { filter: null } },
          },
          {
            id: 'run',
            type: 'command',
            def: {
              run: {
                cmd: 'echo',
                args: [{ name: 'mode', type: 'string', default: null }],
              },
            },
          },
        ],
      });

      expect((caps.tools[0].def as any).defaults).toEqual({ filter: null });
      expect((caps.tools[1].def as any).run.args[0].default).toBeNull();
    });

    it('accepts a bare "description:" key in YAML (parses as null)', async () => {
      const file = join(tempDir, 'capabilities.yaml');
      await writeFile(
        file,
        [
          'providers:',
          '  - claude-code',
          'servers:',
          '  - id: sharecube',
          '    type: mcp',
          '    description:',
          '    def:',
          '      url: https://example.test/mcp',
          '',
        ].join('\n'),
      );

      const caps = await parseCapabilitiesFile(file, 'yaml');
      expect(caps.servers[0].description).toBeUndefined();
    });
  });

  describe('createDefaultCapabilities', () => {
    it('should create default capabilities structure', () => {
      const capabilities = createDefaultCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(capabilities.providers).toBeUndefined();
      expect(capabilities.skills).toBeArray();
      expect(capabilities.servers).toBeArray();
      expect(capabilities.tools).toBeArray();
    });

    it('should include default skills', () => {
      const capabilities = createDefaultCapabilities();

      expect(capabilities.skills.length).toBeGreaterThan(0);
      const abilityManager = capabilities.skills.find(s => s.id === 'capabilities-manager');
      expect(abilityManager).toBeDefined();
    });

    it('should include the bootstrap skill so new projects can capify existing setups', () => {
      const capabilities = createDefaultCapabilities();

      const bootstrap = capabilities.skills.find(s => s.id === 'bootstrap');
      expect(bootstrap).toBeDefined();
      expect(bootstrap?.type).toBe('github');
      expect((bootstrap?.def as { repo?: string })?.repo).toBe('infragate/capa@bootstrap');
    });

    it('should start with an empty tools array', () => {
      const capabilities = createDefaultCapabilities();
      expect(capabilities.tools).toBeArray();
      expect(capabilities.tools.length).toBe(0);
    });

    it('should set toolExposure to on-demand', () => {
      const capabilities = createDefaultCapabilities();
      expect(capabilities.options?.toolExposure).toBe('on-demand');
    });
  });

  describe('writeCapabilitiesFile and parseCapabilitiesFile', () => {
    it('should write and parse JSON capabilities file', async () => {
      const capabilities = createDefaultCapabilities();
      const filePath = join(tempDir, 'capabilities.json');
      
      await writeCapabilitiesFile(filePath, 'json', capabilities);
      const parsed = await parseCapabilitiesFile(filePath, 'json');

      expect(parsed).toEqual({
        ...capabilities,
        plugins: [],
        rules: [],
        subagents: [],
        hooks: [],
      });
    });

    it('should write and parse YAML capabilities file', async () => {
      const capabilities = createDefaultCapabilities();
      const filePath = join(tempDir, 'capabilities.yaml');
      
      await writeCapabilitiesFile(filePath, 'yaml', capabilities);
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');

      expect(parsed).toEqual({
        ...capabilities,
        plugins: [],
        rules: [],
        subagents: [],
        hooks: [],
      });
    });

    it('should parse MCP env/headers secret source objects', async () => {
      const filePath = join(tempDir, 'secret-sources.yaml');
      await writeFile(
        filePath,
        `providers: [cursor]
skills: []
tools: []
servers:
  - id: brave
    type: mcp
    def:
      cmd: npx
      env:
        LITERAL: ${'${BraveApiKey}'}
        FROM_ENV:
          fromEnv: BRAVE_API_KEY
        FROM_CMD:
          fromCommand: op read "op://Vault/Item/credential"
        FROM_FILE:
          fromFile: ./secrets/token
  - id: remote
    type: mcp
    def:
      url: https://mcp.example.com
      headers:
        Authorization:
          fromEnv: MCP_BEARER
`,
      );
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.servers[0].def.env).toEqual({
        LITERAL: '${BraveApiKey}',
        FROM_ENV: { fromEnv: 'BRAVE_API_KEY' },
        FROM_CMD: { fromCommand: 'op read "op://Vault/Item/credential"' },
        FROM_FILE: { fromFile: './secrets/token' },
      });
      expect(parsed.servers[1].def.headers).toEqual({
        Authorization: { fromEnv: 'MCP_BEARER' },
      });
    });

    it('should write JSON with proper formatting', async () => {
      const capabilities: Capabilities = {
        providers: ['test-client'],
        skills: [],
        servers: [],
        tools: [],
      };
      const filePath = join(tempDir, 'capabilities.json');
      
      await writeCapabilitiesFile(filePath, 'json', capabilities);
      const content = await Bun.file(filePath).text();
      
      expect(content).toContain('"providers"');
      expect(content).toContain('"test-client"');
      // Check for proper indentation
      expect(content).toContain('  ');
    });

    it('should handle custom capabilities', async () => {
      const capabilities: Capabilities = {
        providers: ['custom-client'],
        skills: [
          {
            id: 'custom-skill',
            type: 'github',
            def: {
              repo: 'owner/my-package',
              description: 'Custom skill',
            },
          },
        ],
        servers: [],
        tools: [
          {
            id: 'custom-tool',
            type: 'command',
            def: {
              run: {
                cmd: 'echo',
                args: [
                  {
                    name: 'message',
                    type: 'string',
                    description: 'Message to echo',
                    required: true,
                  },
                ],
              },
            },
          },
        ],
      };
      
      const jsonPath = join(tempDir, 'custom.json');
      await writeCapabilitiesFile(jsonPath, 'json', capabilities);
      const parsedJson = await parseCapabilitiesFile(jsonPath, 'json');
      
      expect(parsedJson.skills[0].id).toBe('custom-skill');
      expect(parsedJson.tools[0].id).toBe('custom-tool');
    });
  });

  describe('appendCapabilityEntry', () => {
    it('preserves comments and key order when appending to YAML (#93)', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      const original = [
        '# Top-level comment that must survive',
        'options:',
        '  toolExposure: on-demand # inline comment',
        'skills:',
        '  # existing skill below',
        '  - id: first-skill',
        '    type: github',
        '    def:',
        '      repo: owner/first',
        'servers: []',
        '',
      ].join('\n');
      await Bun.write(filePath, original);

      await appendCapabilityEntry(filePath, 'yaml', 'skills', {
        id: 'second-skill',
        type: 'github',
        def: { repo: 'owner/second' },
      });

      const content = await Bun.file(filePath).text();

      // Comments survive
      expect(content).toContain('# Top-level comment that must survive');
      expect(content).toContain('# inline comment');
      expect(content).toContain('# existing skill below');

      // Original ordering is intact: options block precedes skills, which precedes servers
      expect(content.indexOf('options:')).toBeLessThan(content.indexOf('skills:'));
      expect(content.indexOf('skills:')).toBeLessThan(content.indexOf('servers:'));

      // The new entry was appended and parses correctly
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.skills.map(s => s.id)).toEqual(['first-skill', 'second-skill']);
    });

    it('creates the section when it is missing (YAML)', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(filePath, 'options:\n  toolExposure: on-demand\n');

      await appendCapabilityEntry(filePath, 'yaml', 'plugins', {
        id: 'p1',
        type: 'github',
        def: { repo: 'owner/repo' },
      });

      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.plugins?.map(p => p.id)).toEqual(['p1']);
    });

    it('appends to JSON capabilities files', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await writeCapabilitiesFile(filePath, 'json', createDefaultCapabilities());

      await appendCapabilityEntry(filePath, 'json', 'tools', {
        id: 't1',
        type: 'mcp',
        def: { server: '@srv', tool: 'search' },
      });

      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.tools.map(t => t.id)).toEqual(['t1']);
    });
  });

  describe('removeCapabilityEntry', () => {
    it('removes matching YAML entries while preserving comments', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(
        filePath,
        [
          '# keep me',
          'skills:',
          '  - id: keep',
          '    type: inline',
          '    def:',
          '      content: a',
          '  - id: drop',
          '    type: inline',
          '    def:',
          '      content: b',
          '',
        ].join('\n'),
      );

      const removed = await removeCapabilityEntry(
        filePath,
        'yaml',
        'skills',
        (e) => e.id === 'drop',
      );
      expect(removed).toBe(1);

      const content = await Bun.file(filePath).text();
      expect(content).toContain('# keep me');
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.skills.map((s) => s.id)).toEqual(['keep']);
    });

    it('removes matching JSON entries', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await writeCapabilitiesFile(filePath, 'json', {
        skills: [
          { id: 'a', type: 'inline', def: { content: 'a' } },
          { id: 'b', type: 'inline', def: { content: 'b' } },
        ],
        servers: [],
        tools: [],
      });

      const removed = await removeCapabilityEntry(
        filePath,
        'json',
        'skills',
        (e) => e.id === 'a',
      );
      expect(removed).toBe(1);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.skills.map((s) => s.id)).toEqual(['b']);
    });

    it('returns 0 when section is missing', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(filePath, 'options:\n  toolExposure: on-demand\n');
      const removed = await removeCapabilityEntry(
        filePath,
        'yaml',
        'hooks',
        () => true,
      );
      expect(removed).toBe(0);
    });
  });

  describe('updateCapabilityEntry', () => {
    it('updates the first matching YAML entry', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(
        filePath,
        [
          'skills:',
          '  - id: s1',
          '    type: inline',
          '    def:',
          '      content: old',
          '',
        ].join('\n'),
      );

      const ok = await updateCapabilityEntry(
        filePath,
        'yaml',
        'skills',
        (e) => e.id === 's1',
        (e) => ({
          ...e,
          def: { ...(e.def as object), content: 'new', description: 'updated' },
        }),
      );
      expect(ok).toBe(true);
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.skills[0].def.content).toBe('new');
      expect(parsed.skills[0].def.description).toBe('updated');
    });

    it('updates matching JSON entries', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await writeCapabilitiesFile(filePath, 'json', {
        skills: [],
        servers: [],
        tools: [
          {
            id: 't1',
            type: 'mcp',
            def: { server: '@srv', tool: 'search' },
            description: 'old',
          },
        ],
      });

      const ok = await updateCapabilityEntry(
        filePath,
        'json',
        'tools',
        (e) => e.id === 't1',
        (e) => ({ ...e, description: 'new' }),
      );
      expect(ok).toBe(true);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.tools[0].description).toBe('new');
    });

    it('returns false when no match', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(filePath, 'skills: []\n');
      const ok = await updateCapabilityEntry(
        filePath,
        'yaml',
        'skills',
        (e) => e.id === 'missing',
        (e) => e,
      );
      expect(ok).toBe(false);
    });
  });

  describe('upsertOptions', () => {
    it('merges options into YAML and preserves other keys', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(
        filePath,
        [
          '# header',
          'options:',
          '  toolExposure: on-demand',
          'skills: []',
          '',
        ].join('\n'),
      );

      await upsertOptions(filePath, 'yaml', {
        toolExposure: 'expose-all',
        requiresCommands: [{ cli: 'git', description: 'Git CLI' }],
      });

      const content = await Bun.file(filePath).text();
      expect(content).toContain('# header');
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.options?.toolExposure).toBe('expose-all');
      expect(parsed.options?.requiresCommands).toEqual([
        { cli: 'git', description: 'Git CLI' },
      ]);
    });

    it('creates options when missing (JSON)', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(filePath, JSON.stringify({ skills: [], servers: [], tools: [] }));

      await upsertOptions(filePath, 'json', { toolExposure: 'none' });
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.options?.toolExposure).toBe('none');
    });

    it('removes a key when patch value is undefined', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await writeCapabilitiesFile(filePath, 'json', {
        skills: [],
        servers: [],
        tools: [],
        options: {
          toolExposure: 'on-demand',
          requiresCommands: [{ cli: 'node' }],
        },
      });

      await upsertOptions(filePath, 'json', {
        requiresCommands: undefined,
      });
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.options?.toolExposure).toBe('on-demand');
      expect(parsed.options?.requiresCommands).toBeUndefined();
    });
  });

  describe('reorderCapabilityEntries', () => {
    it('reorders YAML entries while preserving comments', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      const original = [
        'skills:',
        '  # keep me',
        '  - id: alpha',
        '    type: inline',
        '  - id: beta',
        '    type: inline',
        '  - id: gamma',
        '    type: inline',
        '',
      ].join('\n');
      await Bun.write(filePath, original);

      await reorderCapabilityEntries(filePath, 'yaml', 'skills', ['gamma', 'alpha', 'beta']);

      const content = await Bun.file(filePath).text();
      expect(content).toContain('# keep me');
      expect(content.indexOf('id: gamma')).toBeLessThan(content.indexOf('id: alpha'));
      expect(content.indexOf('id: alpha')).toBeLessThan(content.indexOf('id: beta'));

      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.skills.map((s: { id: string }) => s.id)).toEqual([
        'gamma',
        'alpha',
        'beta',
      ]);
    });

    it('reorders JSON entries', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(
        filePath,
        JSON.stringify({
          skills: [
            { id: 'a', type: 'inline' },
            { id: 'b', type: 'inline' },
            { id: 'c', type: 'inline' },
          ],
          servers: [],
          tools: [],
        }),
      );

      await reorderCapabilityEntries(filePath, 'json', 'skills', ['c', 'a', 'b']);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.skills.map((s: { id: string }) => s.id)).toEqual(['c', 'a', 'b']);
    });

    it('reorders tools with duplicate ids using server+tool keys', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(
        filePath,
        JSON.stringify({
          skills: [],
          servers: [],
          tools: [
            {
              id: 'search',
              type: 'mcp',
              def: { server: '@owl', tool: 'search' },
            },
            {
              id: 'search',
              type: 'mcp',
              def: { server: '@other', tool: 'search' },
            },
            {
              id: 'ping',
              type: 'mcp',
              def: { server: '@owl', tool: 'ping' },
            },
          ],
        }),
      );

      await reorderCapabilityEntries(filePath, 'json', 'tools', [
        'search::other::search',
        'ping::owl::ping',
        'search::owl::search',
      ]);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(
        parsed.tools.map((t) => {
          const def = t.def as { server: string; tool: string };
          return [t.id, def.server, def.tool];
        }),
      ).toEqual([
        ['search', '@other', 'search'],
        ['ping', '@owl', 'ping'],
        ['search', '@owl', 'search'],
      ]);
    });

    it('ignores plugin-prefixed skill keys and reorders authored skills', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(
        filePath,
        JSON.stringify({
          skills: [
            { id: 'alpha', type: 'inline' },
            { id: 'beta', type: 'inline' },
          ],
          servers: [],
          tools: [],
        }),
      );

      await reorderCapabilityEntries(filePath, 'json', 'skills', [
        'plugin:demo:shared',
        'beta',
        'plugin:other:shared',
        'alpha',
      ]);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.skills.map((s: { id: string }) => s.id)).toEqual(['beta', 'alpha']);
    });

    it('rejects non-permutation ids', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(
        filePath,
        JSON.stringify({
          skills: [
            { id: 'a', type: 'inline' },
            { id: 'b', type: 'inline' },
          ],
          servers: [],
          tools: [],
        }),
      );

      expect(
        reorderCapabilityEntries(filePath, 'json', 'skills', ['a']),
      ).rejects.toThrow(/exactly once/);
      expect(
        reorderCapabilityEntries(filePath, 'json', 'skills', ['a', 'missing']),
      ).rejects.toThrow(/exactly once/);
    });
  });

  describe('upsertAgents', () => {
    it('writes agents and preserves YAML comments', async () => {
      const filePath = join(tempDir, 'capabilities.yaml');
      await Bun.write(
        filePath,
        [
          '# project capabilities',
          'skills: []',
          'servers: []',
          'tools: []',
          '',
        ].join('\n'),
      );

      await upsertAgents(filePath, 'yaml', {
        base: { type: 'local', path: './docs/AGENTS-base.md' },
        additional: [{ id: 'team', type: 'inline', content: '## Team' }],
      });

      const content = await Bun.file(filePath).text();
      expect(content).toContain('# project capabilities');
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      expect(parsed.agents?.base?.type).toBe('local');
      expect(parsed.agents?.base?.path).toBe('./docs/AGENTS-base.md');
      expect(parsed.agents?.additional).toEqual([
        { id: 'team', type: 'inline', content: '## Team' },
      ]);
    });

    it('removes agents when null', async () => {
      const filePath = join(tempDir, 'capabilities.json');
      await Bun.write(
        filePath,
        JSON.stringify({
          skills: [],
          agents: { additional: [{ id: 'x', type: 'inline', content: 'hi' }] },
        }),
      );

      await upsertAgents(filePath, 'json', null);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      expect(parsed.agents).toBeUndefined();
    });
  });
});
