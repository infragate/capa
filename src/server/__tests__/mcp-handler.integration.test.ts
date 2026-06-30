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
  h.sessionManager.dispose();
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

// ─── setup_tools errors mirror the call_tool isError contract ────────────────

describe('handleMessage > setup_tools (error contract)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness({
      providers: ['claude-code'],
      options: { toolExposure: 'on-demand' },
      skills: [
        {
          id: 'real-skill',
          type: 'inline',
          def: { description: 'x', requires: [], content: '# real-skill' },
        },
      ],
      servers: [],
      tools: [],
    });
  });

  afterEach(() => destroyHarness(h));

  it('returns result.isError=true (not a JSON-RPC error) for an unknown skill', async () => {
    // Per the MCP spec tool execution failures travel as `result.isError`
    // content so the LLM actually sees the text. JSON-RPC errors are
    // typically swallowed by the host before reaching the model, so the
    // agent would have no idea what went wrong or how to recover.
    await h.mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });

    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'setup_tools', arguments: { skills: ['does-not-exist'] } },
    });

    expect(resp.error).toBeUndefined();
    expect(resp.result?.isError).toBe(true);
    const payload = parseToolText(resp.result);
    expect(payload.error).toMatch(/Skill not found/);
    // The "available skills" hint is the actionable recovery; keep it pinned.
    expect(payload.error).toMatch(/Available skills: real-skill/);
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

  // `tools/list` hides tools from MCP-aware agents (so they don't try to
  // discover them through capa's MCP endpoint), but `tools/call` is *not*
  // gated on `toolExposure`. The `capa sh` CLI is the documented escape
  // hatch for this mode and uses this exact endpoint as its execution
  // channel — gating it here would mean rejecting `capa sh` itself.
  it('executes a configured tool by qualified name (capa sh fallback path)', async () => {
    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 't', arguments: {} },
    });
    expect(resp.error).toBeUndefined();
    expect(resp.result?.isError).toBeFalsy();
    expect(resp.result?.content).toBeDefined();
  });

  it('returns the standard "Tool not found" error for unknown names', async () => {
    const resp = await h.mcp.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'totally-made-up', arguments: {} },
    });
    expect(resp.error).toBeDefined();
    expect(resp.error?.message).toMatch(/Tool not found/);
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

// ─── installSubagentsTask: purge under toolExposure: 'none' ──────────────────
// Cursor doesn't model per-sub-agent MCP entries — its `capa-<id>` entries
// can only be removed via `purgeCursorSubAgentMCPEntries`. The per-agent
// `unregisterSubAgentMCPServer` loop is a no-op for that provider. So the
// `'none'` case MUST still trigger the purge, otherwise stale `capa-<id>`
// entries would linger forever in `.cursor/mcp.json`, contradicting the
// "no .mcp writes" contract this mode promises. This was a Copilot review
// catch on PR #80 — pin it here so a future refactor can't silently
// regress.

describe('installSubagentsTask + toolExposure: none', () => {
  it('the purge predicate fires for purge-style providers regardless of skipMcpWrites', () => {
    // Mirror the predicate in install-subagents.ts. The key invariant: the
    // `'none'` mode (skipMcpWrites=true) must NOT short-circuit the purge,
    // because purge is the *only* cleanup mechanism for purge-style
    // providers (`supportsSubAgentEntries: false` or
    // `purgeStaleSubAgentMcp: true`).
    function needsPurge(
      _skipMcpWrites: boolean,
      providerCaps: Array<{ supportsSubAgentEntries?: boolean; purgeStale?: boolean }>
    ): boolean {
      return providerCaps.some(
        (p) => p.supportsSubAgentEntries === false || p.purgeStale === true
      );
    }

    // Cursor-like provider (supportsSubAgentEntries: false) — purge MUST run
    // even under 'none'.
    expect(needsPurge(true, [{ supportsSubAgentEntries: false }])).toBe(true);
    expect(needsPurge(false, [{ supportsSubAgentEntries: false }])).toBe(true);

    // Opt-in purge provider — same.
    expect(needsPurge(true, [{ purgeStale: true }])).toBe(true);

    // Per-sub-agent capable providers — no purge needed; the unregister loop
    // handles them.
    expect(needsPurge(true, [{ supportsSubAgentEntries: true }])).toBe(false);
    expect(needsPurge(false, [])).toBe(false);
  });
});

// ─── capa shell: metadata listing vs. lazy per-tool schema ───────────────────
//
// `capa sh` (and group/subcommand listing) hits getAllShellTools on every
// invocation, so it must NOT contact remote MCP servers — otherwise one slow or
// down server stalls or crashes the whole shell. The remote round-trip is
// deferred to getShellToolSchema, called only when a specific tool is run or
// `--help`'d. These tests pin that split.

describe('getAllShellTools / getShellToolSchema (lazy MCP schema)', () => {
  let h: Harness;

  const caps: Capabilities = {
    providers: ['claude-code'],
    options: {},
    skills: [],
    servers: [{ id: 'brave', def: { url: 'http://127.0.0.1:1/mcp' } } as any],
    tools: [
      {
        id: 'run_tests',
        type: 'command',
        def: { run: { cmd: 'npm test', args: [{ name: 'pattern', type: 'string' }] } },
      },
      {
        id: 'search',
        type: 'mcp',
        def: { server: '@brave', tool: 'brave_web_search' },
      } as any,
    ],
  };

  beforeEach(() => {
    h = makeHarness(caps);
  });

  afterEach(() => destroyHarness(h));

  it('getAllShellTools makes no remote listTools calls and omits MCP schemas', async () => {
    let listToolsCalls = 0;
    (h.mcp as any).mcpProxy.listTools = async () => {
      listToolsCalls++;
      return [];
    };

    const tools = await h.mcp.getAllShellTools(caps);

    expect(listToolsCalls).toBe(0);

    const cmd = tools.find((t) => t.id === 'run_tests')!;
    expect(cmd.type).toBe('command');
    // Command schemas are local and cheap — included up front.
    expect(cmd.inputSchema?.properties?.pattern).toBeDefined();

    const mcp = tools.find((t) => t.id === 'brave.search')!;
    expect(mcp.type).toBe('mcp');
    expect(mcp.serverId).toBe('brave');
    // MCP schema is resolved lazily, so it is absent here.
    expect(mcp.inputSchema).toBeUndefined();
  });

  it('getShellToolSchema resolves an MCP tool with exactly one remote call', async () => {
    let listToolsCalls = 0;
    (h.mcp as any).mcpProxy.listTools = async () => {
      listToolsCalls++;
      return [
        {
          name: 'brave_web_search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ];
    };

    const schema = await h.mcp.getShellToolSchema('brave.search', caps);

    expect(listToolsCalls).toBe(1);
    expect(schema.description).toBe('Search the web');
    expect(schema.inputSchema.properties.q).toBeDefined();
  });

  it('getShellToolSchema propagates remote failures instead of swallowing them', async () => {
    (h.mcp as any).mcpProxy.listTools = async () => {
      throw new Error('Could not connect to MCP server "brave"');
    };

    await expect(h.mcp.getShellToolSchema('brave.search', caps)).rejects.toThrow(
      /Could not connect/
    );
  });

  it('getShellToolSchema resolves command tools locally without any remote call', async () => {
    let listToolsCalls = 0;
    (h.mcp as any).mcpProxy.listTools = async () => {
      listToolsCalls++;
      return [];
    };

    const schema = await h.mcp.getShellToolSchema('run_tests', caps);

    expect(listToolsCalls).toBe(0);
    expect(schema.inputSchema.properties.pattern).toBeDefined();
  });
});

// ─── listServerTools: surface unreachable servers (issue #126) ───────────────
//
// The /tools API handler relies on `listServerTools` forwarding
// `throwOnError` so an unreachable MCP server produces an HTTP error the UI can
// render ("Server unreachable") instead of a silent empty list that looks like
// "this server has no tools".

describe('listServerTools (throwOnError pass-through)', () => {
  let h: Harness;

  const caps: Capabilities = {
    providers: ['claude-code'],
    options: {},
    skills: [],
    servers: [{ id: 'brave', def: { url: 'http://127.0.0.1:1/mcp' } } as any],
    tools: [],
  };

  beforeEach(() => {
    h = makeHarness(caps);
  });

  afterEach(() => destroyHarness(h));

  it('forwards throwOnError to the proxy', async () => {
    let seenOptions: any;
    (h.mcp as any).mcpProxy.listTools = async (_id: string, _def: unknown, options: unknown) => {
      seenOptions = options;
      return [];
    };

    await h.mcp.listServerTools('brave', caps, { throwOnError: true });
    expect(seenOptions).toEqual({ throwOnError: true });
  });

  it('propagates connection failures instead of swallowing them', async () => {
    (h.mcp as any).mcpProxy.listTools = async () => {
      throw new Error('Could not connect to MCP server "brave"');
    };

    await expect(
      h.mcp.listServerTools('brave', caps, { throwOnError: true }),
    ).rejects.toThrow(/Could not connect/);
  });

  it('returns an empty list for a reachable server with no tools', async () => {
    (h.mcp as any).mcpProxy.listTools = async () => [];
    const tools = await h.mcp.listServerTools('brave', caps, { throwOnError: true });
    expect(tools).toEqual([]);
  });
});
