import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as childProcess from 'child_process';
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

  it('spawns subprocesses with windowsHide: true', async () => {
    const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(((
      _cmd: string,
      _args: string[],
      options: { windowsHide?: boolean }
    ) => {
      expect(options.windowsHide).toBe(true);
      const { EventEmitter } = require('events');
      const proc = new EventEmitter() as any;
      proc.pid = 99999;
      proc.stdin = { on: () => {}, end: () => {} };
      proc.stdout = { on: () => {} };
      proc.stderr = { on: () => {} };
      proc.killed = false;
      proc.kill = () => {
        proc.killed = true;
      };
      queueMicrotask(() => proc.emit('spawn'));
      return proc;
    }) as typeof childProcess.spawn);

    await manager.getOrCreateSubprocess('server-b', definition, tempDir);
    expect(spawnSpy).toHaveBeenCalled();
    spawnSpy.mockRestore();
  });
});
