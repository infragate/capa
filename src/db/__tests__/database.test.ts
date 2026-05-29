import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CapaDatabase } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CapaDatabase', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-test-'));
    dbPath = join(tempDir, 'test.db');
    db = new CapaDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  describe('Project operations', () => {
    it('should upsert and retrieve a project', () => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
      
      const project = db.getProject('test-proj');
      expect(project).not.toBeNull();
      expect(project?.id).toBe('test-proj');
      expect(project?.path).toBe('/test/path');
    });

    it('should update existing project', () => {
      db.upsertProject({ id: 'test-proj', path: '/old/path' });
      db.upsertProject({ id: 'test-proj', path: '/new/path' });
      
      const project = db.getProject('test-proj');
      expect(project?.path).toBe('/new/path');
    });

    it('should get project by path', () => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
      
      const project = db.getProjectByPath('/test/path');
      expect(project).not.toBeNull();
      expect(project?.id).toBe('test-proj');
    });

    it('should return null for non-existent project', () => {
      const project = db.getProject('non-existent');
      expect(project).toBeNull();
    });
  });

  describe('Managed hooks operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'hooks-proj', path: '/hooks/path' });
    });

    it('upserts and reads managed hook rows', () => {
      db.upsertManagedHook({
        projectId: 'hooks-proj',
        providerId: 'claude-code',
        hookId: 'audit',
        configPath: '/abs/.claude/settings.json',
        locator: '["PreToolUse",0,"hooks",0]',
        scriptPath: null,
      });
      const rows = db.getManagedHooks('hooks-proj');
      expect(rows).toHaveLength(1);
      expect(rows[0].providerId).toBe('claude-code');
      expect(rows[0].hookId).toBe('audit');
      expect(rows[0].locator).toBe('["PreToolUse",0,"hooks",0]');
    });

    it('upsert replaces an existing (provider, hook) entry', () => {
      db.upsertManagedHook({
        projectId: 'hooks-proj',
        providerId: 'cursor',
        hookId: 'a',
        configPath: '/p1',
        locator: '["x",0]',
        scriptPath: '/script',
      });
      db.upsertManagedHook({
        projectId: 'hooks-proj',
        providerId: 'cursor',
        hookId: 'a',
        configPath: '/p2',
        locator: '["x",1]',
        scriptPath: null,
      });
      const rows = db.getManagedHooks('hooks-proj');
      expect(rows).toHaveLength(1);
      expect(rows[0].configPath).toBe('/p2');
      expect(rows[0].locator).toBe('["x",1]');
      expect(rows[0].scriptPath).toBeNull();
    });

    it('removes individual entries and clears them all', () => {
      db.upsertManagedHook({
        projectId: 'hooks-proj',
        providerId: 'claude-code',
        hookId: 'a',
        configPath: '/p',
        locator: '["x",0]',
        scriptPath: null,
      });
      db.upsertManagedHook({
        projectId: 'hooks-proj',
        providerId: 'cursor',
        hookId: 'b',
        configPath: '/p',
        locator: '["x",0]',
        scriptPath: null,
      });
      db.removeManagedHook('hooks-proj', 'claude-code', 'a');
      expect(db.getManagedHooks('hooks-proj')).toHaveLength(1);
      db.clearManagedHooks('hooks-proj');
      expect(db.getManagedHooks('hooks-proj')).toEqual([]);
    });
  });

  describe('Variable operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should set and get a variable', () => {
      db.setVariable('test-proj', 'API_KEY', 'secret-123');
      
      const value = db.getVariable('test-proj', 'API_KEY');
      expect(value).toBe('secret-123');
    });

    it('should update existing variable', () => {
      db.setVariable('test-proj', 'API_KEY', 'old-value');
      db.setVariable('test-proj', 'API_KEY', 'new-value');
      
      const value = db.getVariable('test-proj', 'API_KEY');
      expect(value).toBe('new-value');
    });

    it('should return null for non-existent variable', () => {
      const value = db.getVariable('test-proj', 'NON_EXISTENT');
      expect(value).toBeNull();
    });

    it('should get all variables for a project', () => {
      db.setVariable('test-proj', 'VAR1', 'value1');
      db.setVariable('test-proj', 'VAR2', 'value2');
      
      const vars = db.getAllVariables('test-proj');
      expect(vars).toEqual({
        VAR1: 'value1',
        VAR2: 'value2',
      });
    });

    it('should delete a variable', () => {
      db.setVariable('test-proj', 'API_KEY', 'secret-123');
      db.deleteVariable('test-proj', 'API_KEY');
      
      const value = db.getVariable('test-proj', 'API_KEY');
      expect(value).toBeNull();
    });
  });

  describe('Managed files operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should add and get managed files', () => {
      db.addManagedFile('test-proj', '/path/to/file1.txt');
      db.addManagedFile('test-proj', '/path/to/file2.txt');
      
      const files = db.getManagedFiles('test-proj');
      expect(files).toEqual(['/path/to/file1.txt', '/path/to/file2.txt']);
    });

    it('should not add duplicate files', () => {
      db.addManagedFile('test-proj', '/path/to/file.txt');
      db.addManagedFile('test-proj', '/path/to/file.txt');
      
      const files = db.getManagedFiles('test-proj');
      expect(files).toEqual(['/path/to/file.txt']);
    });

    it('should remove managed file', () => {
      db.addManagedFile('test-proj', '/path/to/file1.txt');
      db.addManagedFile('test-proj', '/path/to/file2.txt');
      db.removeManagedFile('test-proj', '/path/to/file1.txt');
      
      const files = db.getManagedFiles('test-proj');
      expect(files).toEqual(['/path/to/file2.txt']);
    });

    it('should clear all managed files', () => {
      db.addManagedFile('test-proj', '/path/to/file1.txt');
      db.addManagedFile('test-proj', '/path/to/file2.txt');
      db.clearManagedFiles('test-proj');
      
      const files = db.getManagedFiles('test-proj');
      expect(files).toEqual([]);
    });
  });

  describe('Tool init state operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should set and get tool init state (initialized)', () => {
      db.setToolInitialized('test-proj', 'tool-1', null);
      
      const state = db.getToolInitState('test-proj', 'tool-1');
      expect(state).not.toBeNull();
      expect(state?.initialized).toBeTruthy();
      expect(state?.last_error).toBeNull();
    });

    it('should set tool init state with error', () => {
      db.setToolInitialized('test-proj', 'tool-1', 'Init failed');
      
      const state = db.getToolInitState('test-proj', 'tool-1');
      expect(state).not.toBeNull();
      expect(state?.initialized).toBeFalsy();
      expect(state?.last_error).toBe('Init failed');
    });

    it('should update existing tool init state', () => {
      db.setToolInitialized('test-proj', 'tool-1', 'Error');
      db.setToolInitialized('test-proj', 'tool-1', null);
      
      const state = db.getToolInitState('test-proj', 'tool-1');
      expect(state?.initialized).toBeTruthy();
      expect(state?.last_error).toBeNull();
    });
  });

  describe('MCP subprocess operations', () => {
    it('should upsert and get MCP subprocess', () => {
      db.upsertMCPSubprocess({
        id: 'subprocess-1',
        config_hash: 'hash123',
        pid: 12345,
        port: 8080,
        status: 'running',
      });
      
      const subprocess = db.getMCPSubprocess('subprocess-1');
      expect(subprocess).not.toBeNull();
      expect(subprocess?.id).toBe('subprocess-1');
      expect(subprocess?.pid).toBe(12345);
      expect(subprocess?.status).toBe('running');
    });

    it('should get subprocess by config hash', () => {
      db.upsertMCPSubprocess({
        id: 'subprocess-1',
        config_hash: 'hash123',
        pid: 12345,
        port: 8080,
        status: 'running',
      });
      
      const subprocess = db.getMCPSubprocessByHash('hash123');
      expect(subprocess).not.toBeNull();
      expect(subprocess?.id).toBe('subprocess-1');
    });

    it('should get all MCP subprocesses', () => {
      db.upsertMCPSubprocess({
        id: 'subprocess-1',
        config_hash: 'hash1',
        pid: 123,
        port: 8080,
        status: 'running',
      });
      db.upsertMCPSubprocess({
        id: 'subprocess-2',
        config_hash: 'hash2',
        pid: 456,
        port: 8081,
        status: 'stopped',
      });
      
      const subprocesses = db.getAllMCPSubprocesses();
      expect(subprocesses.length).toBe(2);
    });

    it('should delete MCP subprocess', () => {
      db.upsertMCPSubprocess({
        id: 'subprocess-1',
        config_hash: 'hash123',
        pid: 12345,
        port: 8080,
        status: 'running',
      });
      db.deleteMCPSubprocess('subprocess-1');
      
      const subprocess = db.getMCPSubprocess('subprocess-1');
      expect(subprocess).toBeNull();
    });
  });

  describe('Project capabilities operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should set and get project capabilities (round-trip JSON)', () => {
      const capabilitiesJson = JSON.stringify({
        providers: ['cursor'],
        skills: [{ id: 'skill-1', type: 'inline', def: { description: 'Test', requires: ['tool-1'] } }],
        tools: [{ id: 'tool-1', type: 'mcp', def: { server: '@s1', tool: 'run' } }],
        servers: [{ id: 's1', type: 'mcp', def: { cmd: 'node', args: ['server.js'] } }],
      });
      db.setProjectCapabilities('test-proj', capabilitiesJson);

      const retrieved = db.getProjectCapabilities('test-proj');
      expect(retrieved).not.toBeNull();
      expect(retrieved).toBe(capabilitiesJson);
      const parsed = JSON.parse(retrieved!);
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].id).toBe('skill-1');
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.servers).toHaveLength(1);
    });

    it('should return null for project with no capabilities', () => {
      const retrieved = db.getProjectCapabilities('test-proj');
      expect(retrieved).toBeNull();
    });

    it('should return null for non-existent project', () => {
      const retrieved = db.getProjectCapabilities('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should update existing project capabilities', () => {
      db.setProjectCapabilities('test-proj', JSON.stringify({ providers: [], skills: [], tools: [], servers: [] }));
      db.setProjectCapabilities('test-proj', JSON.stringify({
        providers: ['cursor'],
        skills: [{ id: 'updated', type: 'inline', def: {} }],
        tools: [],
        servers: [],
      }));

      const retrieved = db.getProjectCapabilities('test-proj');
      const parsed = JSON.parse(retrieved!);
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].id).toBe('updated');
    });
  });

  describe('Session operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should create and get session', () => {
      db.createSession('session-1', 'test-proj');
      
      const session = db.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session?.session_id).toBe('session-1');
      expect(session?.project_id).toBe('test-proj');
    });

    it('should update session activity', () => {
      db.createSession('session-1', 'test-proj');
      const session1 = db.getSession('session-1');
      
      // Wait a bit
      Bun.sleepSync(10);
      
      db.updateSessionActivity('session-1');
      const session2 = db.getSession('session-1');
      
      expect(session2?.last_activity).toBeGreaterThan(session1!.last_activity);
    });

    it('should update session skills', () => {
      db.createSession('session-1', 'test-proj');
      db.updateSessionSkills('session-1', ['skill-1', 'skill-2']);
      
      const session = db.getSession('session-1');
      expect(session?.skill_ids).toBe(JSON.stringify(['skill-1', 'skill-2']));
    });

    it('should delete session', () => {
      db.createSession('session-1', 'test-proj');
      db.deleteSession('session-1');
      
      const session = db.getSession('session-1');
      expect(session).toBeNull();
    });

    it('should delete expired sessions', () => {
      // Create a session and manually set old last_activity
      db.createSession('session-1', 'test-proj');
      db.createSession('session-2', 'test-proj');
      
      // Directly update one session to be expired (older than 1 minute)
      const oneHourAgo = Date.now() - 61 * 60 * 1000;
      const dbInternal = (db as any).db;
      dbInternal.run(
        'UPDATE sessions SET last_activity = ? WHERE session_id = ?',
        [oneHourAgo, 'session-1']
      );
      
      db.deleteExpiredSessions(60);
      
      expect(db.getSession('session-1')).toBeNull();
      expect(db.getSession('session-2')).not.toBeNull();
    });
  });

  describe('Project provider operations', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
    });

    it('should set and get providers for a project', () => {
      db.setProjectProviders('test-proj', ['cursor', 'claude-code']);

      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual(['cursor', 'claude-code']);
    });

    it('should return empty array when no providers are set', () => {
      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual([]);
    });

    it('should replace providers on subsequent set', () => {
      db.setProjectProviders('test-proj', ['cursor', 'claude-code']);
      db.setProjectProviders('test-proj', ['codex']);

      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual(['codex']);
    });

    it('should handle single provider', () => {
      db.setProjectProviders('test-proj', ['cursor']);

      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual(['cursor']);
    });

    it('should handle empty providers array (clears all)', () => {
      db.setProjectProviders('test-proj', ['cursor', 'claude-code']);
      db.setProjectProviders('test-proj', []);

      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual([]);
    });

    it('should be cleaned up when project is deleted', () => {
      db.setProjectProviders('test-proj', ['cursor']);
      db.deleteProject('test-proj');

      const providers = db.getProjectProviders('test-proj');
      expect(providers).toEqual([]);
    });
  });

  describe('deleteProject transaction', () => {
    beforeEach(() => {
      db.upsertProject({ id: 'test-proj', path: '/test/path' });
      db.setVariable('test-proj', 'KEY', 'value');
      db.addManagedFile('test-proj', '/file.txt');
      db.createSession('session-1', 'test-proj');
    });

    it('should rollback cascade when a delete fails mid-way', () => {
      const dbInternal = (db as any).db;
      const originalRun = dbInternal.run.bind(dbInternal);
      let deleteCallCount = 0;

      dbInternal.run = function (...args: unknown[]) {
        deleteCallCount++;
        if (deleteCallCount === 2) {
          throw new Error('simulated delete failure');
        }
        return originalRun(...args);
      };

      try {
        expect(() => db.deleteProject('test-proj')).toThrow('simulated delete failure');
        expect(db.getProject('test-proj')).not.toBeNull();
        expect(db.getVariable('test-proj', 'KEY')).toBe('value');
        expect(db.getManagedFiles('test-proj')).toEqual(['/file.txt']);
        expect(db.getSession('session-1')).not.toBeNull();
      } finally {
        dbInternal.run = originalRun;
      }
    });

    it('should use db.transaction for deleteProject cascade', () => {
      const dbInternal = (db as any).db;
      const originalTransaction = dbInternal.transaction.bind(dbInternal);
      let transactionUsed = false;

      dbInternal.transaction = function (fn: (id: string) => void) {
        transactionUsed = true;
        return originalTransaction(fn);
      };

      try {
        db.deleteProject('test-proj');
        expect(transactionUsed).toBe(true);
        expect(db.getProject('test-proj')).toBeNull();
      } finally {
        dbInternal.transaction = originalTransaction;
      }
    });
  });
});
