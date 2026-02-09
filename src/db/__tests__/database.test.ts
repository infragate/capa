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
    rmSync(tempDir, { recursive: true, force: true });
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
});
