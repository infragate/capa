import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CommandToolExecutor } from '../tool-executor';
import { CapaDatabase } from '../../db/database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolCommandDefinition } from '../../types/capabilities';

describe('CommandToolExecutor', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let executor: CommandToolExecutor;
  const projectId = 'test-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-executor-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: projectId, path: tempDir });
    executor = new CommandToolExecutor(db, projectId, tempDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('default argument values', () => {
    it('should use default when argument is not provided', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {greeting}',
          args: [
            { name: 'greeting', type: 'string', default: 'hello' },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('hello');
    });

    it('should allow caller to override the default', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {greeting}',
          args: [
            { name: 'greeting', type: 'string', default: 'hello' },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, { greeting: 'bonjour' });
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('bonjour');
    });

    it('should use defaults for some args and caller values for others', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {name} {count}',
          args: [
            { name: 'name', type: 'string', required: true },
            { name: 'count', type: 'number', default: 10 },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, { name: 'items' });
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('items 10');
    });

    it('should fail when required arg without default is missing', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {name} {count}',
          args: [
            { name: 'name', type: 'string', required: true },
            { name: 'count', type: 'number', default: 10 },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required argument: name');
    });

    it('should treat arg with default as optional even if required is not set', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {limit}',
          args: [
            { name: 'limit', type: 'number', default: 25 },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('25');
    });

    it('should handle multiple args all with defaults', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {a} {b} {c}',
          args: [
            { name: 'a', type: 'string', default: 'x' },
            { name: 'b', type: 'string', default: 'y' },
            { name: 'c', type: 'string', default: 'z' },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, { b: 'B' });
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('x B z');
    });

    it('should handle boolean default', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {verbose}',
          args: [
            { name: 'verbose', type: 'boolean', default: false },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('false');
    });
  });

  describe('argument handling (no defaults)', () => {
    it('should substitute required args normally', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [
            { name: 'message', type: 'string', required: true },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, { message: 'hi' });
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('hi');
    });

    it('should fail when required arg is missing and no default', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [
            { name: 'message', type: 'string', required: true },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required argument: message');
    });

    it('should allow optional arg to be omitted', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo done',
          args: [
            { name: 'verbose', type: 'boolean', required: false },
          ],
        },
      };

      const result = await executor.execute('test-tool', def, {});
      expect(result.success).toBe(true);
      expect(result.result?.trim()).toBe('done');
    });
  });
});
