import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { SessionManager } from '../session-manager';
import type { Capabilities } from '../../types/capabilities';

describe('SessionManager', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let sessionManager: SessionManager;

  const capabilities: Capabilities = {
    providers: ['cursor'],
    skills: [],
    tools: [],
    servers: [],
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-session-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: 'test-proj', path: '/test/path' });
    sessionManager = new SessionManager(db);
    sessionManager.setProjectCapabilities('test-proj', capabilities);
  });

  afterEach(() => {
    sessionManager.dispose();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('should return a copy of project capabilities map', () => {
    const returned = sessionManager.getAllProjectCapabilities();

    expect(returned.get('test-proj')).toEqual(capabilities);
    returned.set('mutated', { providers: [], skills: [], tools: [], servers: [] });

    expect(sessionManager.getAllProjectCapabilities().has('mutated')).toBe(false);
    expect(sessionManager.getAllProjectCapabilities().get('test-proj')).toEqual(capabilities);
  });
});
