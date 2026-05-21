import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { SubprocessManager } from '../subprocess-manager';
import type { MCPServerDefinition } from '../../types/capabilities';

describe('SubprocessManager', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let manager: SubprocessManager;

  const definition: MCPServerDefinition = {
    cmd: 'node',
    args: ['-e', 'setInterval(() => {}, 1000)'],
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-subprocess-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    manager = new SubprocessManager(db);
  });

  afterEach(async () => {
    manager.stopAll();
    await Bun.sleep(200);
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('should dedupe concurrent getOrCreateSubprocess calls for the same config', async () => {
    let createCount = 0;
    const managerAny = manager as unknown as {
      createSubprocess: (...args: unknown[]) => Promise<unknown>;
    };
    const originalCreate = managerAny.createSubprocess.bind(manager);
    managerAny.createSubprocess = async (...args: unknown[]) => {
      createCount++;
      await Bun.sleep(50);
      return originalCreate(...args);
    };

    const [first, second] = await Promise.all([
      manager.getOrCreateSubprocess('server-a', definition, tempDir),
      manager.getOrCreateSubprocess('server-a', definition, tempDir),
    ]);

    expect(createCount).toBe(1);
    expect(first.id).toBe('server-a');
    expect(second.id).toBe('server-a');
  });
});
