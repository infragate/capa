import { describe, expect, it } from 'bun:test';
import type { Server, Tool } from '../types/api';
import {
  addingToolCuratesServer,
  authoredTools,
  computeServerExposure,
  effectiveToolExposure,
  skillRequiresApplies,
  toolsForTokenSavings,
} from './serverExposure';

const server = (id: string, expose?: Server['expose'], exposeTools?: string[]): Server =>
  ({ id, type: 'mcp', expose: expose ?? null, exposeTools: exposeTools ?? null }) as Server;

const mcp = (server: string, tool: string, fromServerExpose = false): Tool => ({
  id: `${server}-${tool}`,
  type: 'mcp',
  sourcePlugin: null,
  mcpServer: `@${server}`,
  mcpTool: tool,
  fromServerExpose,
});

const names = (set: Set<string>) => [...set].sort();

describe('computeServerExposure', () => {
  it('applies the policy to the live tool list when it is available', () => {
    const exposure = computeServerExposure(
      [server('github'), server('narrow', 'exactly', ['search']), server('blocked', 'except', ['delete'])],
      // No synthesized snapshot at all (e.g. before the first configure).
      [],
      {
        github: ['search', 'create_issue'],
        narrow: ['search', 'create_issue'],
        blocked: ['search', 'delete'],
      },
    );
    expect(exposure.github).toMatchObject({ mode: 'all', totalTools: 2 });
    expect(names(exposure.github.exposedToolNames)).toEqual(['create_issue', 'search']);
    expect(names(exposure.narrow.exposedToolNames)).toEqual(['search']);
    expect(names(exposure.blocked.exposedToolNames)).toEqual(['search']);
  });

  it('falls back to synthesized tools when the live list is unavailable', () => {
    const exposure = computeServerExposure(
      [server('github'), server('slack', 'except', ['post'])],
      [mcp('github', 'search', true), mcp('slack', 'read', true)],
    );
    expect(exposure.github).toMatchObject({ mode: 'all', totalTools: null });
    expect(names(exposure.github.exposedToolNames)).toEqual(['search']);
    expect(names(exposure.slack.exposedToolNames)).toEqual(['read']);
  });

  it('reports an empty live list as zero tools, not unavailable', () => {
    const exposure = computeServerExposure([server('github')], [], { github: [] });
    expect(exposure.github).toEqual({ mode: 'all', exposedToolNames: new Set(), totalTools: 0 });
  });

  it('treats a server with authored tool entries as curated', () => {
    const exposure = computeServerExposure(
      [server('github', 'all')],
      [mcp('github', 'search')],
      { github: ['search', 'create_issue'] },
    );
    expect(exposure.github.mode).toBe('curated');
    expect(names(exposure.github.exposedToolNames)).toEqual(['search']);
    expect(exposure.github.totalTools).toBe(2);
  });

  it('exposes nothing for expose: none', () => {
    const exposure = computeServerExposure([server('github', 'none')], [], { github: ['search'] });
    expect(exposure.github).toEqual({ mode: 'none', exposedToolNames: new Set(), totalTools: 1 });
  });
});

describe('helpers', () => {
  it('authoredTools drops synthesized tools', () => {
    expect(authoredTools([mcp('a', 'x'), mcp('a', 'y', true)]).map((t) => t.mcpTool)).toEqual(['x']);
  });

  it('warns before curating only for servers exposing through a policy', () => {
    const exposure = (mode: 'all' | 'curated' | 'none') => ({
      mode,
      exposedToolNames: new Set<string>(),
      totalTools: null,
    });
    expect(addingToolCuratesServer(exposure('all'))).toBe(true);
    expect(addingToolCuratesServer(exposure('curated'))).toBe(false);
    expect(addingToolCuratesServer(exposure('none'))).toBe(false);
    expect(addingToolCuratesServer(undefined)).toBe(false);
  });

  it('counts policy-exposed tools toward token cost only in expose-all', () => {
    const all = [mcp('a', 'x'), mcp('a', 'y', true)];
    expect(toolsForTokenSavings('expose-all', all)).toHaveLength(2);
    expect(toolsForTokenSavings(null, all)).toHaveLength(2);
    expect(toolsForTokenSavings('search', all).map((t) => t.mcpTool)).toEqual(['x']);
    expect(toolsForTokenSavings('on-demand', all).map((t) => t.mcpTool)).toEqual(['x']);
  });

  it('requires only applies outside search mode; omitted mode is expose-all', () => {
    expect(skillRequiresApplies('search')).toBe(false);
    expect(skillRequiresApplies('on-demand')).toBe(true);
    expect(skillRequiresApplies(null)).toBe(true);
    expect(effectiveToolExposure(undefined)).toBe('expose-all');
  });
});
