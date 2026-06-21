import { describe, it, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
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

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-executor-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: projectId, path: tempDir });
    executor = new CommandToolExecutor(db, projectId, tempDir);
  });

  afterAll(() => {
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

  describe('spawn options', () => {
    it('spawns the parsed program with argv (no shell), windowsHide:true', async () => {
      const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(((
        command: string,
        args: string[] | childProcess.SpawnOptions,
        options?: childProcess.SpawnOptions
      ) => {
        expect(command).toBe('echo');
        expect(args).toEqual(['hello']);
        expect(options?.shell).toBe(false);
        expect(options?.windowsHide).toBe(true);
        const { EventEmitter } = require('events');
        const proc = new EventEmitter() as any;
        proc.stdout = { on: (_: string, cb: (d: Buffer) => void) => cb(Buffer.from('hello\n')) };
        proc.stderr = { on: () => {} };
        queueMicrotask(() => proc.emit('exit', 0));
        return proc;
      }) as typeof childProcess.spawn);

      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo hello',
          args: [],
        },
      };

      const result = await executor.execute('spawn-test', def, {});
      expect(result.success).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      spawnSpy.mockRestore();
    });
  });

  // GHSA-rhp4-jmr9-fmc5: caller-supplied argument values must never escape into
  // shell metacharacters. The fix decides the argv shape from the operator
  // template alone, then substitutes values as inert argv elements with
  // shell:false. Each test below replays an exploit pattern from the advisory.
  describe('command injection prevention (GHSA-rhp4-jmr9-fmc5)', () => {
    it('treats shell metacharacters in arg values as literal text', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const payload = 'benign-looking; echo INJECTED';
      const result = await executor.execute('injection-semicolon', def, { message: payload });
      expect(result.success).toBe(true);
      // Without the fix the shell would run two commands and the output would
      // contain a second line `INJECTED`. With the fix the whole payload is a
      // single argv element to echo, printed verbatim.
      expect(result.result).toBe(payload);
    });

    it('does not execute a chained command from a backtick payload', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const payload = '`echo PWNED`';
      const result = await executor.execute('injection-backticks', def, { message: payload });
      expect(result.success).toBe(true);
      expect(result.result).toBe(payload);
    });

    it('does not execute a chained command from $(...) command substitution', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const payload = '$(echo PWNED)';
      const result = await executor.execute('injection-cmdsubst', def, { message: payload });
      expect(result.success).toBe(true);
      expect(result.result).toBe(payload);
    });

    it('does not interpret pipes or redirects in arg values', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const payload = 'foo | tee /tmp/CAPA_GHSA_RHP4_SHOULD_NOT_EXIST > /dev/null';
      const result = await executor.execute('injection-pipe', def, { message: payload });
      expect(result.success).toBe(true);
      expect(result.result).toBe(payload);
      // Defensive: make sure the side-effect path didn't get created.
      const { existsSync } = require('fs');
      expect(existsSync('/tmp/CAPA_GHSA_RHP4_SHOULD_NOT_EXIST')).toBe(false);
    });

    it('keeps a multi-word value as a single argv element', async () => {
      const def: ToolCommandDefinition = {
        run: {
          cmd: 'echo {message}',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const result = await executor.execute('whitespace-arg', def, {
        message: 'hello   world',
      });
      expect(result.success).toBe(true);
      // shell:true would have collapsed runs of whitespace; shell:false
      // preserves the value as the single argument it conceptually is.
      expect(result.result).toBe('hello   world');
    });

    it('substitutes operator-quoted templates without losing the value', async () => {
      const def: ToolCommandDefinition = {
        run: {
          // Operators were previously expected to manually quote placeholders
          // for safety. After the fix the quoting is no longer required, but
          // existing templates that DO quote should still work.
          cmd: 'echo "{message}"',
          args: [{ name: 'message', type: 'string', required: true }],
        },
      };

      const result = await executor.execute('quoted-template', def, {
        message: "it's a; test",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBe("it's a; test");
    });
  });
});
