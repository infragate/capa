import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  parseCapabilitiesFile,
  createDefaultCapabilities,
  writeCapabilitiesFile,
} from '../capabilities';
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

  describe('createDefaultCapabilities', () => {
    it('should create default capabilities structure', () => {
      const capabilities = createDefaultCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(capabilities.clients).toBeArray();
      expect(capabilities.skills).toBeArray();
      expect(capabilities.servers).toBeArray();
      expect(capabilities.tools).toBeArray();
      expect(capabilities.clients).toContain('cursor');
      expect(capabilities.clients).toContain('claude-code');
    });

    it('should include default skills', () => {
      const capabilities = createDefaultCapabilities();
      
      expect(capabilities.skills.length).toBeGreaterThan(0);
      const abilityManager = capabilities.skills.find(s => s.id === 'capabilities-manager');
      expect(abilityManager).toBeDefined();
    });

    it('should include default tools', () => {
      const capabilities = createDefaultCapabilities();
      
      expect(capabilities.tools.length).toBeGreaterThan(0);
      expect(capabilities.tools.some(t => t.id === 'capa_init')).toBe(true);
      expect(capabilities.tools.some(t => t.id === 'capa_install')).toBe(true);
      expect(capabilities.tools.some(t => t.id === 'find_skills')).toBe(true);
    });
  });

  describe('writeCapabilitiesFile and parseCapabilitiesFile', () => {
    it('should write and parse JSON capabilities file', async () => {
      const capabilities = createDefaultCapabilities();
      const filePath = join(tempDir, 'capabilities.json');
      
      await writeCapabilitiesFile(filePath, 'json', capabilities);
      const parsed = await parseCapabilitiesFile(filePath, 'json');
      
      expect(parsed).toEqual(capabilities);
    });

    it('should write and parse YAML capabilities file', async () => {
      const capabilities = createDefaultCapabilities();
      const filePath = join(tempDir, 'capabilities.yaml');
      
      await writeCapabilitiesFile(filePath, 'yaml', capabilities);
      const parsed = await parseCapabilitiesFile(filePath, 'yaml');
      
      expect(parsed).toEqual(capabilities);
    });

    it('should write JSON with proper formatting', async () => {
      const capabilities: Capabilities = {
        clients: ['test-client'],
        skills: [],
        servers: [],
        tools: [],
      };
      const filePath = join(tempDir, 'capabilities.json');
      
      await writeCapabilitiesFile(filePath, 'json', capabilities);
      const content = await Bun.file(filePath).text();
      
      expect(content).toContain('"clients"');
      expect(content).toContain('"test-client"');
      // Check for proper indentation
      expect(content).toContain('  ');
    });

    it('should handle custom capabilities', async () => {
      const capabilities: Capabilities = {
        clients: ['custom-client'],
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
