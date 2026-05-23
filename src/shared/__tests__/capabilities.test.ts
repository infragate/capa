import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  parseCapabilitiesFile,
  createDefaultCapabilities,
  writeCapabilitiesFile,
  normalizeCapabilities,
} from '../capabilities';
import { logger } from '../logger';
import { mkdtempSync, rmSync } from 'fs';
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

    it('defaults missing servers, tools, plugins, rules, and subagents to empty arrays', () => {
      const result = normalizeCapabilities({});
      expect(result.servers).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.plugins).toEqual([]);
      expect(result.rules).toEqual([]);
      expect(result.subagents).toEqual([]);
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
      };

      const result = normalizeCapabilities(capabilities);
      expect(result).toEqual(capabilities);
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
});
