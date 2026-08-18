import { describe, it, expect, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import {
  applyToolFormatter,
  buildToolCallText,
  extractCapaShellMeta,
  serializeToolResult,
  CAPA_RAW_ARG,
} from '../tool-formatter';
import type { Tool } from '../../types/capabilities';

/**
 * Portable formatter commands using a fixture script so tests pass on Windows
 * (cmd.exe), macOS, and Linux without depending on jq/sed/cat/sleep or nested quotes.
 * Use a repo-relative path (no spaces) so cmd.exe /C does not mangle quoting.
 */
const helper = 'src/server/__tests__/fixtures/formatter-helper.ts';
const REPLACE_OLD_WITH_NEW = `bun ${helper} replace`;
const EXTRACT_JSON_NAME = `bun ${helper} name`;
const PASSTHROUGH = `bun ${helper} passthrough`;
const EXIT_ONE = `bun ${helper} fail`;
const SLEEP_FIVE = `bun ${helper} sleep`;

describe('extractCapaShellMeta', () => {
  it('returns args unchanged when meta key is absent', () => {
    expect(extractCapaShellMeta({ query: 'select 1' })).toEqual({
      cleanArgs: { query: 'select 1' },
      skipFormatter: false,
    });
  });

  it('strips _capa_raw and sets skipFormatter', () => {
    expect(extractCapaShellMeta({ query: 'x', [CAPA_RAW_ARG]: true })).toEqual({
      cleanArgs: { query: 'x' },
      skipFormatter: true,
    });
  });

  it('treats string "true" as skipFormatter', () => {
    expect(extractCapaShellMeta({ [CAPA_RAW_ARG]: 'true' }).skipFormatter).toBe(true);
  });
});

describe('serializeToolResult', () => {
  it('unwraps command tool success output', () => {
    expect(serializeToolResult({ success: true, result: 'hello' })).toBe('hello');
  });

  it('unwraps MCP proxy text content', () => {
    expect(
      serializeToolResult({
        result: [{ type: 'text', text: '{"a":1}' }],
      })
    ).toBe('{\n  "a": 1\n}');
  });
});

describe('buildToolCallText', () => {
  const mcpTool: Tool = {
    id: 'query',
    type: 'mcp',
    def: {
      server: '@db',
      tool: 'run_query',
      formatter: { cmd: REPLACE_OLD_WITH_NEW },
    },
  };

  it('applies formatter for MCP tools', async () => {
    const text = await buildToolCallText({ success: true, result: 'OLD value' }, mcpTool);
    expect(text).toBe('NEW value');
  });

  it('skips formatter when requested', async () => {
    const text = await buildToolCallText(
      { success: true, result: 'OLD value' },
      mcpTool,
      { skipFormatter: true }
    );
    expect(text).toBe('OLD value');
  });

  it('ignores formatter on command tools', async () => {
    const commandTool: Tool = {
      id: 'echo',
      type: 'command',
      def: { run: { cmd: 'echo hi' } },
    };
    const text = await buildToolCallText({ success: true, result: 'OLD value' }, commandTool);
    expect(text).toBe('OLD value');
  });
});

describe('applyToolFormatter', () => {
  it('returns transformed stdout on success', async () => {
    const out = await applyToolFormatter('{"name":"alice"}', {
      cmd: EXTRACT_JSON_NAME,
    });
    expect(out).toBe('alice');
  });

  it('preserves tab and newline characters in output', async () => {
    const out = await applyToolFormatter('a\tb\nc', {
      cmd: PASSTHROUGH,
    });
    expect(out).toBe('a\tb\nc');
  });

  it('returns original input when command fails', async () => {
    const input = '{"keep":true}';
    const out = await applyToolFormatter(input, {
      cmd: EXIT_ONE,
    });
    expect(out).toBe(input);
  });

  it('returns original input on timeout', async () => {
    const input = 'slow';
    const out = await applyToolFormatter(input, {
      cmd: SLEEP_FIVE,
      timeout: 50,
    });
    expect(out).toBe(input);
  });

  it('spawns a tokenized argv with shell disabled', async () => {
    const spawnSpy = spyOn(childProcess, 'spawn');
    try {
      await applyToolFormatter('x', { cmd: PASSTHROUGH });
      expect(spawnSpy.mock.calls.length).toBeGreaterThan(0);
      const [program, argv, opts] = spawnSpy.mock.calls[0] as [
        string,
        string[],
        { shell?: boolean },
      ];
      expect(opts?.shell).toBe(false);
      expect(String(program)).not.toMatch(/(?:^|[/\\])(sh|cmd\.exe)$/i);
      expect(Array.isArray(argv)).toBe(true);
      expect(argv[0]).not.toBe('-c');
      expect(argv[0]).not.toBe('/C');
    } finally {
      spawnSpy.mockRestore();
    }
  });

  it('does not run a formatter string as a shell script', async () => {
    const out = await applyToolFormatter('original', {
      cmd: 'false; echo pwned',
    });
    expect(out).toBe('original');
    expect(out).not.toContain('pwned');
  });
});
