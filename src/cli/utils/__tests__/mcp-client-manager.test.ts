import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  registerMCPServer,
  unregisterMCPServer,
  getSupportedMCPClients,
  getMCPClientDisplayName,
} from '../mcp-client-manager';

describe('mcp-client-manager', () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = mkdtempSync(join(tmpdir(), 'capa-mcp-test-'));
    projectPath = tempDir;
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getSupportedMCPClients', () => {
    it('should return list of supported clients', () => {
      const clients = getSupportedMCPClients();
      
      expect(clients).toBeArray();
      expect(clients.length).toBeGreaterThan(0);
      expect(clients).toContain('cursor');
      expect(clients).toContain('claude-code');
    });
  });

  describe('getMCPClientDisplayName', () => {
    it('should return display name for cursor', () => {
      const displayName = getMCPClientDisplayName('cursor');
      expect(displayName).toBe('Cursor');
    });

    it('should return display name for claude-code', () => {
      const displayName = getMCPClientDisplayName('claude-code');
      expect(displayName).toBe('Claude Code');
    });

    it('should handle case-insensitive client names', () => {
      const displayName = getMCPClientDisplayName('CURSOR');
      expect(displayName).toBe('Cursor');
    });

    it('should return undefined for unknown client', () => {
      const displayName = getMCPClientDisplayName('unknown-client');
      expect(displayName).toBeUndefined();
    });
  });

  describe('registerMCPServer - Cursor', () => {
    it('should create new config file for cursor', async () => {
      const projectId = 'test-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-1234/mcp';
      
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      expect(existsSync(configPath)).toBe(true);
      
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers['capa-test-project-1234']).toBeDefined();
      expect(config.mcpServers['capa-test-project-1234'].url).toBe(mcpUrl);
    });

    it('should preserve existing servers when adding new one', async () => {
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      
      // Create existing config
      mkdirSync(join(projectPath, '.cursor'), { recursive: true });
      const existingConfig = {
        mcpServers: {
          'existing-server': {
            url: 'http://example.com/mcp',
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');
      
      // Register new server
      const projectId = 'test-project-5678';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-5678/mcp';
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Verify both servers exist
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['existing-server']).toBeDefined();
      expect(config.mcpServers['existing-server'].url).toBe('http://example.com/mcp');
      expect(config.mcpServers['capa-test-project-5678']).toBeDefined();
      expect(config.mcpServers['capa-test-project-5678'].url).toBe(mcpUrl);
    });

    it('should update existing server if already registered', async () => {
      const projectId = 'test-project-1234';
      const oldUrl = 'http://127.0.0.1:5912/old-url/mcp';
      const newUrl = 'http://127.0.0.1:5912/new-url/mcp';
      
      // Register first time
      await registerMCPServer(projectPath, projectId, oldUrl, ['cursor']);
      
      // Register again with new URL
      await registerMCPServer(projectPath, projectId, newUrl, ['cursor']);
      
      // Verify updated
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['capa-test-project-1234'].url).toBe(newUrl);
    });

    it('should handle malformed existing config gracefully', async () => {
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      
      // Create malformed config
      mkdirSync(join(projectPath, '.cursor'), { recursive: true });
      writeFileSync(configPath, 'invalid json{', 'utf-8');
      
      // Register new server (should overwrite malformed config)
      const projectId = 'test-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-1234/mcp';
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Verify new config is valid
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers['capa-test-project-1234']).toBeDefined();
    });
  });

  describe('registerMCPServer - Claude Code', () => {
    it('should create new config file for claude-code', async () => {
      const projectId = 'test-project-abcd';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-abcd/mcp';
      
      await registerMCPServer(projectPath, projectId, mcpUrl, ['claude-code']);
      
      const configPath = join(projectPath, '.mcp.json');
      expect(existsSync(configPath)).toBe(true);
      
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers['capa-test-project-abcd']).toBeDefined();
      expect(config.mcpServers['capa-test-project-abcd'].url).toBe(mcpUrl);
    });

    it('should preserve existing servers in claude-code config', async () => {
      const configPath = join(projectPath, '.mcp.json');
      
      // Create existing config
      const existingConfig = {
        mcpServers: {
          'another-server': {
            url: 'http://another.example.com/mcp',
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');
      
      // Register new server
      const projectId = 'test-project-xyz';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-xyz/mcp';
      await registerMCPServer(projectPath, projectId, mcpUrl, ['claude-code']);
      
      // Verify both servers exist
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['another-server']).toBeDefined();
      expect(config.mcpServers['capa-test-project-xyz']).toBeDefined();
    });
  });

  describe('registerMCPServer - Multiple Clients', () => {
    it('should register with multiple clients simultaneously', async () => {
      const projectId = 'multi-client-test';
      const mcpUrl = 'http://127.0.0.1:5912/multi-client-test/mcp';
      
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor', 'claude-code']);
      
      // Verify cursor config
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      expect(existsSync(cursorConfigPath)).toBe(true);
      const cursorConfig = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
      expect(cursorConfig.mcpServers['capa-multi-client-test']).toBeDefined();
      
      // Verify claude-code config
      const claudeConfigPath = join(projectPath, '.mcp.json');
      expect(existsSync(claudeConfigPath)).toBe(true);
      const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      expect(claudeConfig.mcpServers['capa-multi-client-test']).toBeDefined();
    });

    it('should skip unknown clients without failing', async () => {
      const projectId = 'test-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-1234/mcp';
      
      // Should not throw even with unknown client
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor', 'unknown-client']);
      
      // Verify cursor still works
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      expect(existsSync(cursorConfigPath)).toBe(true);
    });
  });

  describe('unregisterMCPServer - Cursor', () => {
    it('should remove server from cursor config', async () => {
      const projectId = 'test-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-1234/mcp';
      
      // Register first
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Verify registered
      let configPath = join(projectPath, '.cursor', 'mcp.json');
      let config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['capa-test-project-1234']).toBeDefined();
      
      // Unregister
      await unregisterMCPServer(projectPath, projectId, ['cursor']);
      
      // Verify removed
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['capa-test-project-1234']).toBeUndefined();
    });

    it('should preserve other servers when unregistering', async () => {
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      
      // Create config with multiple servers
      mkdirSync(join(projectPath, '.cursor'), { recursive: true });
      const existingConfig = {
        mcpServers: {
          'existing-server': {
            url: 'http://example.com/mcp',
          },
          'capa-test-project-1234': {
            url: 'http://127.0.0.1:5912/test-project-1234/mcp',
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');
      
      // Unregister capa server
      await unregisterMCPServer(projectPath, 'test-project-1234', ['cursor']);
      
      // Verify existing server still there, capa server removed
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers['existing-server']).toBeDefined();
      expect(config.mcpServers['capa-test-project-1234']).toBeUndefined();
    });

    it('should handle non-existent config file gracefully', async () => {
      // Should not throw when config doesn't exist
      await unregisterMCPServer(projectPath, 'test-project-1234', ['cursor']);
      
      // Verify no config was created
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      expect(existsSync(configPath)).toBe(false);
    });

    it('should handle non-existent server gracefully', async () => {
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      
      // Create config without the server
      mkdirSync(join(projectPath, '.cursor'), { recursive: true });
      const config = {
        mcpServers: {
          'other-server': {
            url: 'http://example.com/mcp',
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // Try to unregister non-existent server
      await unregisterMCPServer(projectPath, 'test-project-1234', ['cursor']);
      
      // Verify config unchanged
      const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(updatedConfig.mcpServers['other-server']).toBeDefined();
    });

    it('should handle malformed config gracefully', async () => {
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      
      // Create malformed config
      mkdirSync(join(projectPath, '.cursor'), { recursive: true });
      writeFileSync(configPath, 'invalid json{', 'utf-8');
      
      // Should not throw
      await unregisterMCPServer(projectPath, 'test-project-1234', ['cursor']);
    });
  });

  describe('unregisterMCPServer - Multiple Clients', () => {
    it('should unregister from multiple clients simultaneously', async () => {
      const projectId = 'multi-client-test';
      const mcpUrl = 'http://127.0.0.1:5912/multi-client-test/mcp';
      
      // Register first
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor', 'claude-code']);
      
      // Unregister from both
      await unregisterMCPServer(projectPath, projectId, ['cursor', 'claude-code']);
      
      // Verify removed from cursor
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      const cursorConfig = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
      expect(cursorConfig.mcpServers['capa-multi-client-test']).toBeUndefined();
      
      // Verify removed from claude-code
      const claudeConfigPath = join(projectPath, '.mcp.json');
      const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      expect(claudeConfig.mcpServers['capa-multi-client-test']).toBeUndefined();
    });

    it('should skip unknown clients without failing', async () => {
      const projectId = 'test-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/test-project-1234/mcp';
      
      // Register with cursor
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Unregister with cursor and unknown client (should not throw)
      await unregisterMCPServer(projectPath, projectId, ['cursor', 'unknown-client']);
      
      // Verify cursor was unregistered
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      const cursorConfig = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
      expect(cursorConfig.mcpServers['capa-test-project-1234']).toBeUndefined();
    });
  });

  describe('Case Sensitivity', () => {
    it('should handle case-insensitive client names in registerMCPServer', async () => {
      const projectId = 'test-case-sensitivity';
      const mcpUrl = 'http://127.0.0.1:5912/test-case-sensitivity/mcp';
      
      // Register with uppercase client name
      await registerMCPServer(projectPath, projectId, mcpUrl, ['CURSOR', 'Claude-Code']);
      
      // Verify cursor config exists
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      expect(existsSync(cursorConfigPath)).toBe(true);
      
      // Verify claude-code config exists
      const claudeConfigPath = join(projectPath, '.mcp.json');
      expect(existsSync(claudeConfigPath)).toBe(true);
    });

    it('should handle case-insensitive client names in unregisterMCPServer', async () => {
      const projectId = 'test-case-sensitivity-2';
      const mcpUrl = 'http://127.0.0.1:5912/test-case-sensitivity-2/mcp';
      
      // Register with lowercase
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Unregister with uppercase
      await unregisterMCPServer(projectPath, projectId, ['CURSOR']);
      
      // Verify removed
      const cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
      const cursorConfig = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
      expect(cursorConfig.mcpServers['capa-test-case-sensitivity-2']).toBeUndefined();
    });
  });

  describe('Server Key Generation', () => {
    it('should generate consistent server keys', async () => {
      const projectId = 'my-project-1234';
      const mcpUrl = 'http://127.0.0.1:5912/my-project-1234/mcp';
      
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      
      // Server key should be prefixed with 'capa-'
      expect(config.mcpServers['capa-my-project-1234']).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty clients array', async () => {
      const projectId = 'test-empty-clients';
      const mcpUrl = 'http://127.0.0.1:5912/test-empty-clients/mcp';
      
      // Should not throw with empty array
      await registerMCPServer(projectPath, projectId, mcpUrl, []);
      
      // Verify no configs were created
      expect(existsSync(join(projectPath, '.cursor', 'mcp.json'))).toBe(false);
      expect(existsSync(join(projectPath, '.mcp.json'))).toBe(false);
    });

    it('should handle project IDs with special characters', async () => {
      const projectId = 'my_project-123!@#';
      const mcpUrl = 'http://127.0.0.1:5912/my_project-123/mcp';
      
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      const configPath = join(projectPath, '.cursor', 'mcp.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      
      // Should create server key with special chars
      expect(config.mcpServers['capa-my_project-123!@#']).toBeDefined();
    });

    it('should create nested directories if they do not exist', async () => {
      const projectId = 'test-nested-dirs';
      const mcpUrl = 'http://127.0.0.1:5912/test-nested-dirs/mcp';
      
      // Verify .cursor directory doesn't exist
      expect(existsSync(join(projectPath, '.cursor'))).toBe(false);
      
      // Register should create it
      await registerMCPServer(projectPath, projectId, mcpUrl, ['cursor']);
      
      // Verify directory and file were created
      expect(existsSync(join(projectPath, '.cursor'))).toBe(true);
      expect(existsSync(join(projectPath, '.cursor', 'mcp.json'))).toBe(true);
    });
  });
});
