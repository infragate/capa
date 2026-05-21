import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { GitIntegrationManager } from '../git-integration-manager';

describe('GitIntegrationManager', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let manager: GitIntegrationManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-git-int-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new GitIntegrationManager(db);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('constructs without throwing', () => {
    expect(manager).toBeInstanceOf(GitIntegrationManager);
  });

  it('reports connected state per platform via isConnected', () => {
    expect(manager.isConnected('github')).toBe(false);

    db.setGitIntegration('github', {
      access_token: 'gh-token',
      token_type: 'Bearer',
    });

    expect(manager.isConnected('github')).toBe(true);
    expect(manager.isConnected('gitlab')).toBe(false);
  });

  it('maps platforms to display names in getAllIntegrations', () => {
    db.setGitIntegration('github', { access_token: 'gh', token_type: 'Bearer' });
    db.setGitIntegration('gitlab', { access_token: 'gl', token_type: 'Bearer' });

    const integrations = manager.getAllIntegrations();
    const byPlatform = Object.fromEntries(integrations.map((i) => [i.platform, i.displayName]));

    expect(byPlatform.github).toBe('GitHub');
    expect(byPlatform.gitlab).toBe('GitLab');
  });

  it('returns null token and false refresh for unsupported platform', async () => {
    db.setGitIntegration('github-enterprise', {
      host: 'git.example.com',
      access_token: 'pat',
      refresh_token: 'refresh',
      token_type: 'token',
      expires_at: Date.now() - 1000,
    });

    expect(await manager.getAccessToken('github-enterprise', 'git.example.com')).toBe('pat');
    expect(await manager.refreshAccessToken('github-enterprise', 'git.example.com')).toBe(false);
  });

  it('returns null when no integration exists for a platform', async () => {
    expect(await manager.getAccessToken('gitlab')).toBeNull();
  });
});
