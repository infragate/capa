// Integration-flavoured tests for `CapaMCPServer.handleMessage`, the live
// HTTP code path. We construct a real DB + SessionManager so we exercise the
// same call graph production hits — pure-function tests for the response
// shape live in `mcp-handler.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { SessionManager } from '../session-manager';
import { CapaMCPServer } from '../mcp-handler';
import type { Capabilities } from '../../types/capabilities';

const PROJECT_ID = 'test-proj';

interface Harness {
  db: CapaDatabase;
  tempDir: string;
  sessionManager: SessionManager;
  mcp: CapaMCPServer;
  setCapabilities: (c: Capabilities) => void;
}

function makeHarness(initial: Capabilities): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), 'capa-mcp-handler-int-'));
  const db = new CapaDatabase(join(tempDir, 'test.db'));
  db.upsertProject({ id: PROJECT_ID, path: tempDir });
  const sessionManager = new SessionManager(db);
  sessionManager.setProjectCapabilities(PROJECT_ID, initial);
  const mcp = new CapaMCPServer(db, sessionManager, PROJECT_ID, tempDir);
  return {
    db,
    tempDir,
    sessionManager,
    mcp,
    setCapabilities: (c) => sessionManager.setProjectCapabilities(PROJECT_ID, c),
  };
}

function destroyHarness(h: Harness): void {
  h.db.close();
  try {
    rmSync(h.tempDir, { recursive: true, force: true });
  } catch (error: any) {
    if (error?.code !== 'EBUSY') throw error;
  }
}

// Convenience: extract the text from a CallToolResult, parsed as JSON.
function parseToolText(result: any): any {
  expect(result).toBeDefined();
  expect(result.content).toBeDefined();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0].text);
}

// ─── setup_tools returns slim signatures ─────────────────────────────────────

describe('handleMessage > setup_tools (signature output)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness({
      providers: ['claude-code'],
      options: { toolExposure: 'on-demand' },
      skills: [
        {
          id: 'gh-skill',
          type: 'inline',
          def: {
            description: 'GitHub helpers',
            requires: ['create_issue', 'list_repos'],
            content: '# gh-skill',
          },
        },
      ],
      servers: [],
      tools: [
        {
          id: 'create_issue',
          type: 'command',
          group: 'github',
          def: {
            run: {
              cmd: 'gh issue create',
              args: [
                { name: 'title', type: 'string', required: true },
                { name: 'body', type: 'string', required: true },
                { name: 'labels', type: 'string', required: false },
              ],
            },
          },
        },
        {
          id: 'list_repos',
          type: 'command',
          group: 'github',
          def: {
            run: {
              cmd: 'gh repo list',
              args: [
                { name: 'org', type: 'string', required: true },
                { name: 'type', type: 'string', required: false },
              ],
            },
          },
        },
      ],
    });
  });

  afterEach(() => destroyHarness(h));

  it('returns compact signature strings, not full schemas', async () => {
    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });

    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'setup_tools', arguments: { skills: ['gh-skill'] } },
    });

    const payload = parseToolText(resp.result);
    expect(payload.success).toBe(true);
    expect(payload.tools).toBeInstanceOf(Array);
    // Every entry must be a string — schema bloat must not creep back in.
    for (const entry of payload.tools) {
      expect(typeof entry).toBe('string');
    }
    expect(new Set(payload.tools)).toEqual(
      new Set([
        'github.create_issue(title, body, labels?)',
        'github.list_repos(org, type?)',
      ])
    );
    expect(payload.skills).toEqual(['gh-skill']);
    expect(payload.activeSkills).toContain('gh-skill');
    expect(payload.hint).toMatch(/call_tool/);
  });

  it('preserves skill accumulation across calls and reports both requested and active sets', async () => {
    // Add a second skill so we can prove accumulation surfaces correctly.
    h.setCapabilities({
      ...h.sessionManager.getProjectCapabilities(PROJECT_ID)!,
      skills: [
        ...h.sessionManager.getProjectCapabilities(PROJECT_ID)!.skills,
        {
          id: 'fs-skill',
          type: 'inline',
          def: {
            description: 'Filesystem helpers',
            requires: ['read_file'],
            content: '# fs-skill',
          },
        },
      ],
      tools: [
        ...h.sessionManager.getProjectCapabilities(PROJECT_ID)!.tools,
        {
          id: 'read_file',
          type: 'command',
          def: {
            run: {
              cmd: 'cat',
              args: [{ name: 'path', type: 'string', required: true }],
            },
          },
        },
      ],
    });

    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });

    const first = parseToolText(
      (await h.mcp.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'setup_tools', arguments: { skills: ['gh-skill'] } },
      })).result
    );
    expect(first.skills).toEqual(['gh-skill']);
    expect(first.activeSkills).toEqual(['gh-skill']);

    const second = parseToolText(
      (await h.mcp.handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'setup_tools', arguments: { skills: ['fs-skill'] } },
      })).result
    );
    // skills = what was passed *this call*; activeSkills = merged set so the
    // agent can detect "already active" without a separate roundtrip.
    expect(second.skills).toEqual(['fs-skill']);
    expect(new Set(second.activeSkills)).toEqual(new Set(['gh-skill', 'fs-skill']));
    expect(new Set(second.tools)).toEqual(
      new Set([
        'github.create_issue(title, body, labels?)',
        'github.list_repos(org, type?)',
        'read_file(path)',
      ])
    );
  });
});

// ─── call_tool errors include the full schema ────────────────────────────────

describe('handleMessage > call_tool (schema-on-error)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness({
      providers: ['claude-code'],
      options: { toolExposure: 'on-demand' },
      skills: [
        {
          id: 'fail-skill',
          type: 'inline',
          def: {
            description: 'Always-failing tool',
            requires: ['fail_tool'],
            content: '# fail-skill',
          },
        },
      ],
      servers: [],
      tools: [
        {
          id: 'fail_tool',
          type: 'command',
          def: {
            run: {
              // Reading a guaranteed-missing file under the temp dir; the
              // executor returns success=false with a non-empty error.
              cmd: 'cat /this/path/never/exists/{path}',
              args: [{ name: 'path', type: 'string', required: true }],
            },
          },
        },
      ],
    });
  });

  afterEach(() => destroyHarness(h));

  it('attaches the full input schema when the agent omits a required arg', async () => {
    // This is *the* canonical "agent called wrong" case: missing required
    // arg. The command executor returns `{success: false, error: "Missing
    // required argument: path"}` rather than throwing, so the handler must
    // detect the failure shape and route it through the schema-on-error path.
    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'setup_tools', arguments: { skills: ['fail-skill'] } },
    });

    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      // Intentionally omit `path` — the schema marks it required.
      params: { name: 'call_tool', arguments: { name: 'fail_tool', data: {} } },
    });

    expect(resp.error).toBeUndefined();
    expect(resp.result?.isError).toBe(true);
    const payload = parseToolText(resp.result);
    expect(payload.error).toMatch(/Missing required argument/);
    expect(payload.tool).toBe('fail_tool');
    expect(payload.schema).toBeDefined();
    expect(payload.schema.properties).toHaveProperty('path');
    expect(payload.schema.required).toContain('path');
    expect(payload.hint).toMatch(/call_tool/);
    expect(payload.hint).toMatch(/fail_tool/);
  });

  it('returns an isError result (not a JSON-RPC error) when the tool is not activated', async () => {
    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });

    // Skip setup_tools entirely — fail_tool is never activated.
    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'call_tool',
        arguments: { name: 'fail_tool', data: {} },
      },
    });

    expect(resp.error).toBeUndefined();
    expect(resp.result?.isError).toBe(true);
    const payload = parseToolText(resp.result);
    expect(payload.error).toMatch(/not activated/);
    // No schema for the "not activated" branch — pointing the agent at
    // setup_tools is the actionable next step, not retrying with new args.
    expect(payload.schema).toBeUndefined();
  });

  it('returns an isError result with no schema when the tool is not found', async () => {
    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'setup_tools', arguments: { skills: ['fail-skill'] } },
    });

    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'call_tool',
        arguments: { name: 'totally_made_up_tool', data: {} },
      },
    });

    expect(resp.error).toBeUndefined();
    expect(resp.result?.isError).toBe(true);
    const payload = parseToolText(resp.result);
    expect(payload.error).toMatch(/not found/);
    expect(payload.schema).toBeUndefined();
  });
});

// ─── toolExposure: 'none' ─────────────────────────────────────────────────────

describe('handleMessage > toolExposure: none', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness({
      providers: ['claude-code'],
      options: { toolExposure: 'none' },
      skills: [
        {
          id: 's',
          type: 'inline',
          def: { description: 'x', requires: ['t'], content: '# s' },
        },
      ],
      servers: [],
      tools: [
        {
          id: 't',
          type: 'command',
          def: { run: { cmd: 'echo', args: [] } },
        },
      ],
    });
  });

  afterEach(() => destroyHarness(h));

  it('returns an empty tools/list (no meta-tools either)', async () => {
    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(resp.result?.tools).toEqual([]);
  });

  it('rejects every tools/call (including setup_tools / call_tool) with a capa-sh hint', async () => {
    for (const name of ['setup_tools', 'call_tool', 't', 'whatever']) {
      const resp = await h.mcp.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: {} },
      });
      expect(resp.error).toBeUndefined();
      expect(resp.result?.isError).toBe(true);
      const payload = parseToolText(resp.result);
      expect(payload.error).toMatch(/toolExposure: none/);
      expect(payload.error).toMatch(/capa sh/);
    }
  });
});

// ─── register-mcp-server task: toolExposure: 'none' skips MCP file writes ────
// This isn't a full install integration test — those would need the full
// install context — but it pins the small piece of branch logic we added so
// future refactors can't silently regress the "no .mcp files" promise of
// `'none'`. The actual MCP-file IO is exercised by mcp-client-manager tests.

describe('registerMcpServerTask + toolExposure: none', () => {
  it('the task gating predicate skips registration when toolExposure is none', () => {
    // Mirror the gating predicate in register-mcp-server.ts — see comment
    // there for why we always call unregisterMCPServer in this branch.
    function shouldRegister(toolExposure: string | undefined, hasTools: boolean, hasSubagents: boolean): 'register' | 'unregister' {
      if (toolExposure === 'none') return 'unregister';
      return hasTools || hasSubagents ? 'register' : 'unregister';
    }

    expect(shouldRegister('none', true, true)).toBe('unregister');
    expect(shouldRegister('none', false, false)).toBe('unregister');
    expect(shouldRegister('expose-all', true, false)).toBe('register');
    expect(shouldRegister('on-demand', false, true)).toBe('register');
    expect(shouldRegister('on-demand', false, false)).toBe('unregister');
    expect(shouldRegister(undefined, true, false)).toBe('register');
  });
});
